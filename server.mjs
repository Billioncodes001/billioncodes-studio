import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initialState, act } from "./domain.mjs";

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
export function createApplication(
  database = process.env.DATABASE || resolve(root, "data/workspace.sqlite"),
) {
  if (database !== ":memory:")
    mkdirSync(dirname(resolve(database)), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);",
  );
  db.prepare("INSERT OR IGNORE INTO workspace VALUES (1,?)").run(
    JSON.stringify(initialState()),
  );
  const csrf = randomBytes(32).toString("hex");
  const buckets = new Map();
  const state = () =>
    JSON.parse(db.prepare("SELECT data FROM workspace WHERE id=1").get().data);
  const server = createServer(async (req, res) => {
    const origin = "http://127.0.0.1:" + server.address().port;
    const hosts = [
      "127.0.0.1:" + server.address().port,
      "localhost:" + server.address().port,
    ];
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
      if (!hosts.includes(req.headers.host))
        return json(403, { error: "Untrusted host." });
      const path = new URL(req.url, origin).pathname;
      if (req.method === "GET" && path === "/api/state")
        return json(200, { state: state(), csrf });
      if (req.method === "GET" && path === "/api/health")
        return json(200, { ok: true });
      if (path === "/api/action" && req.method === "POST") {
        if (
          req.headers.origin &&
          !["http://" + req.headers.host].includes(req.headers.origin)
        )
          return json(403, { error: "Cross-origin requests are blocked." });
        if (req.headers["x-csrf-token"] !== csrf)
          return json(403, { error: "Reload the page before saving." });
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          return json(415, { error: "JSON required." });
        const now = Date.now(),
          key = req.socket.remoteAddress;
        const bucket = buckets.get(key) || { count: 0, start: now };
        if (now - bucket.start > 60000) {
          bucket.count = 0;
          bucket.start = now;
        }
        buckets.set(key, bucket);
        if (++bucket.count > 90) {
          res.setHeader("Retry-After", "60");
          return json(429, {
            error: "Too many requests. Try again in a minute.",
          });
        }
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 16384)
            return json(413, { error: "Request too large." });
        }
        let input;
        try {
          input = JSON.parse(raw);
        } catch {
          return json(400, { error: "Invalid JSON." });
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          return json(400, { error: "Invalid request." });
        db.exec("BEGIN IMMEDIATE");
        try {
          const current = state();
          const message = act(current, input);
          if (JSON.stringify(current).length > 1000000)
            throw new Error("Workspace is full.");
          db.prepare("UPDATE workspace SET data=? WHERE id=1").run(
            JSON.stringify(current),
          );
          db.exec("COMMIT");
          return json(200, { state: current, message });
        } catch (error) {
          db.exec("ROLLBACK");
          return json(400, { error: error.message || "Could not save." });
        }
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        return json(405, { error: "Method not allowed." });
      if (path.startsWith("/api/"))
        return json(404, { error: "Endpoint not found." });
      const file = resolve(
        root,
        "public",
        "." + (path === "/" ? "/index.html" : decodeURIComponent(path)),
      );
      const allowed = resolve(root, "public") + "/";
      if (!file.startsWith(allowed) || !types[extname(file)])
        return json(404, { error: "Not found." });
      let content;
      try {
        if (!statSync(file).isFile()) throw new Error();
        content = readFileSync(file);
      } catch {
        return json(404, { error: "Not found." });
      }
      res.writeHead(200, { "Content-Type": types[extname(file)] });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (!res.headersSent)
        json(500, {
          error: "The local workspace could not complete this request.",
        });
      else res.end();
      console.error(error.message);
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
    console.log("Local demo: http://127.0.0.1:" + port),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close());
}
