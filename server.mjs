import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  initialState,
  migrate,
  act,
  listProposals,
  getProposal,
  publicProposal,
  Problem,
} from "./domain.mjs";
import { exportProposal } from "./proposal-export.mjs";
const root = dirname(fileURLToPath(import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".png": "image/png",
};
const digest = (value) => createHash("sha256").update(value).digest();
function localPassword() {
  if (process.env.STUDIO_PASSWORD !== undefined)
    return process.env.STUDIO_PASSWORD;
  try {
    return (
      parseEnv(readFileSync(resolve(root, ".env"), "utf8")).STUDIO_PASSWORD ||
      ""
    );
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
export function createApplication(
  database = process.env.DATABASE || resolve(root, "data/workspace.sqlite"),
  options = {},
) {
  const password = options.password ?? localPassword();
  if (password && password.length < 16)
    throw new Error("STUDIO_PASSWORD must be at least 16 characters.");
  const passwordHash = digest(password);
  const now = options.now || Date.now;
  if (database !== ":memory:")
    mkdirSync(dirname(resolve(database)), { recursive: true });
  const db = new DatabaseSync(database);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); BEGIN IMMEDIATE;",
    );
    db.prepare("INSERT OR IGNORE INTO workspace VALUES (1,?)").run(
      JSON.stringify(initialState()),
    );
    const old = db.prepare("SELECT data FROM workspace WHERE id=1").get().data;
    const migrated = JSON.stringify(migrate(JSON.parse(old)));
    if (old !== migrated)
      db.prepare("UPDATE workspace SET data=? WHERE id=1").run(migrated);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    db.close();
    throw error;
  }
  const state = () =>
    JSON.parse(db.prepare("SELECT data FROM workspace WHERE id=1").get().data);
  const sessions = new Map(),
    buckets = new Map();
  const cookieName = "studio_session";
  function throttle(key, limit, windowMs) {
    const time = now();
    for (const [k, b] of buckets) if (b.until <= time) buckets.delete(k);
    if (!buckets.has(key)) {
      if (buckets.size >= 1000)
        throw new Problem(
          "The local request limit is busy. Try again later.",
          429,
        );
      buckets.set(key, { count: 0, until: time + windowMs });
    }
    if (++buckets.get(key).count > limit)
      throw new Problem("Too many requests. Try again later.", 429);
  }
  const server = createServer(async (req, res) => {
    const port = server.address().port;
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const json = (code, value) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (
        !["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host)
      )
        throw new Problem("Untrusted host.", 403);
      const url = new URL(req.url, "http://" + req.headers.host),
        path = url.pathname;
      const time = now();
      for (const [key, session] of sessions)
        if (session.expires <= time) sessions.delete(key);
      const token =
        (req.headers.cookie || "")
          .split(";")
          .map((c) => c.trim())
          .find((c) => c.startsWith(cookieName + "="))
          ?.slice(cookieName.length + 1) || "";
      const sessionKey = digest(token).toString("hex");
      const session = sessions.get(sessionKey);
      if (req.method === "GET" && path === "/api/health")
        return json(200, { ok: true });
      if (req.method === "GET" && path === "/api/session")
        return json(200, {
          configured: Boolean(password),
          authenticated: Boolean(session),
          csrf: session?.csrf,
        });
      if (path.startsWith("/api/") && req.method === "POST") {
        if (
          req.headers.origin &&
          req.headers.origin !== "http://" + req.headers.host
        )
          throw new Problem("Cross-origin requests are blocked.", 403);
        if (req.headers["sec-fetch-site"] === "cross-site")
          throw new Problem("Cross-site requests are blocked.", 403);
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          throw new Problem("JSON required.", 415);
        if (path !== "/api/login") {
          if (!session)
            throw new Problem(
              "Unlock the workspace to continue. Your unsaved draft is kept in this tab.",
              401,
            );
          if (req.headers["x-csrf-token"] !== session.csrf)
            throw new Problem(
              "Session changed. Unlock the workspace again before saving.",
              403,
            );
        }
        throttle(
          (path === "/api/login" ? "login:" : "write:") +
            req.socket.remoteAddress,
          path === "/api/login" ? 10 : 90,
          path === "/api/login" ? 15 * 60000 : 60000,
        );
        let chunks = [],
          size = 0;
        // Drain over-limit bodies without destroying the socket before the 413 response.
        for await (const chunk of req) {
          size += chunk.length;
          if (size <= 65536) chunks.push(chunk);
        }
        if (size > 65536)
          throw new Problem("Request too large (64 KiB maximum).", 413);
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new Problem("Invalid JSON.");
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new Problem("Invalid request.");
        if (path === "/api/login") {
          if (!password)
            throw new Problem(
              "Set STUDIO_PASSWORD on this machine and restart the server to enable the private workspace.",
              503,
            );
          if (
            typeof input.password !== "string" ||
            !timingSafeEqual(digest(input.password), passwordHash)
          )
            throw new Problem("Incorrect workspace password.", 401);
          if (session) sessions.delete(sessionKey);
          if (sessions.size >= 100)
            sessions.delete(sessions.keys().next().value);
          const next = randomBytes(32).toString("hex"),
            csrf = randomBytes(32).toString("hex");
          sessions.set(digest(next).toString("hex"), {
            csrf,
            expires: time + 8 * 3600000,
          });
          res.setHeader(
            "Set-Cookie",
            `${cookieName}=${next}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
          );
          return json(200, { csrf, authenticated: true, configured: true });
        }
        if (path === "/api/logout") {
          sessions.delete(sessionKey);
          res.setHeader(
            "Set-Cookie",
            `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
          );
          return json(200, { ok: true });
        }
        if (path !== "/api/action")
          throw new Problem("Endpoint not found.", 404);
        db.exec("BEGIN IMMEDIATE");
        try {
          const current = state(),
            result = act(current, input, time);
          if (result.changed) {
            const raw = JSON.stringify(current);
            if (Buffer.byteLength(raw) > 10 * 1024 * 1024)
              throw new Problem(
                "Workspace storage limit reached (10 MiB). Export and back up before starting a separate workspace.",
                409,
              );
            db.prepare("UPDATE workspace SET data=? WHERE id=1").run(raw);
          }
          db.exec("COMMIT");
          return json(200, {
            proposal: publicProposal(result.proposal),
            proposals: listProposals(current),
            message: result.message,
          });
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      if (path.startsWith("/api/")) {
        if (!session)
          throw new Problem(
            "Unlock the workspace to view saved proposals.",
            401,
          );
        if (req.method !== "GET") throw new Problem("Method not allowed.", 405);
        if (path === "/api/state") {
          const current = state();
          return json(200, {
            proposals: listProposals(current),
            legacy: current.legacy,
          });
        }
        const legacyMatch = path.match(/^\/api\/legacy\/([\da-f-]+)$/i);
        if (legacyMatch) {
          const legacy = state().legacy.find(
            (record) => record.id === legacyMatch[1],
          );
          if (!legacy) throw new Problem("Legacy record not found.", 404);
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="studio-legacy-record.json"',
          );
          return json(200, {
            format: "studio-legacy-v1",
            warning:
              "Original fictional estimate. Read-only historical data, not a commercial quote.",
            record: legacy,
          });
        }
        const match = path.match(/^\/api\/proposals\/([\da-f-]+)(\/export)?$/i);
        if (match) {
          const proposal = getProposal(state(), match[1]);
          if (!match[2])
            return json(200, { proposal: publicProposal(proposal) });
          const output = exportProposal(
            proposal,
            Number(url.searchParams.get("revision")),
            url.searchParams.get("format"),
          );
          res.setHeader(
            "Content-Disposition",
            `${output.ext === "html" ? "inline" : "attachment"}; filename="studio-${proposal.id}-r${Number(url.searchParams.get("revision"))}.${output.ext}"`,
          );
          res.writeHead(200, { "Content-Type": output.type });
          return res.end(output.body);
        }
        throw new Problem("Endpoint not found.", 404);
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new Problem("Method not allowed.", 405);
      let decoded;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        throw new Problem("Invalid path.", 400);
      }
      const file = resolve(
        root,
        "public",
        "." + (decoded === "/" ? "/index.html" : decoded),
      );
      if (
        !file.startsWith(resolve(root, "public") + "/") ||
        !types[extname(file)]
      )
        throw new Problem("Not found.", 404);
      let content;
      try {
        if (!statSync(file).isFile()) throw new Error();
        content = readFileSync(file);
      } catch {
        throw new Problem("Not found.", 404);
      }
      res.writeHead(200, { "Content-Type": types[extname(file)] });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error.status === 429) res.setHeader("Retry-After", "900");
      if (!res.headersSent)
        json(error instanceof Problem ? error.status : 500, {
          error:
            error instanceof Problem
              ? error.message
              : "The local workspace could not complete this request. Your draft has not been cleared. Retry safely or check disk access.",
        });
      else res.end();
      if (!(error instanceof Problem))
        console.error("Workspace request failed:", error.message);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => db.close());
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT || 5203);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const server = createApplication();
  server.listen(port, "127.0.0.1", () =>
    console.log("Studio local workspace: http://127.0.0.1:" + port),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close());
}
