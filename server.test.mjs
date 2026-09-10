import { test } from "node:test";
import { get } from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApplication } from "./server.mjs";
import { initialState } from "./domain.mjs";
import { sample, request, password } from "./fixtures.mjs";
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "studio-test-")),
    file = join(dir, "workspace.sqlite"),
    servers = [];
  t.after(async () => {
    for (const server of servers)
      if (server.listening) {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
    rmSync(dir, { recursive: true, force: true });
  });
  async function start(extra = {}) {
    const server = createApplication(file, { password, ...options, ...extra });
    servers.push(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = "http://127.0.0.1:" + server.address().port;
    const call = (path, body, headers = {}) =>
      fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      });
    async function login() {
      const response = await call("/api/login", { password });
      assert.equal(response.status, 200);
      return {
        Cookie: response.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": (await response.json()).csrf,
      };
    }
    return { server, base, call, login };
  }
  return { file, start };
}
test("unconfigured workspaces keep all data and exports private", async (t) => {
  const f = await fixture(t, { password: "" }),
    s = await f.start();
  assert.equal((await (await s.call("/api/session")).json()).configured, false);
  for (const path of [
    "/api/state",
    "/api/proposals/123/export?format=json&revision=1",
    "/api/legacy/123",
  ])
    assert.equal((await s.call(path)).status, 401);
  assert.equal(
    (await s.call("/api/action", request("create", { proposal: sample() })))
      .status,
    401,
  );
  assert.equal((await s.call("/api/login", { password })).status, 503);
  assert.throws(
    () => createApplication(":memory:", { password: "short" }),
    /16 characters/,
  );
});
test("cookies, CSRF rotation, exact session expiry and logout invalidation", async (t) => {
  let now = Date.now();
  const f = await fixture(t, { now: () => now }),
    s = await f.start();
  const response = await s.call("/api/login", { password });
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const h = {
    Cookie: response.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": (await response.json()).csrf,
  };
  assert.equal((await s.call("/api/state", undefined, h)).status, 200);
  assert.equal(
    (await s.call("/api/action", {}, { ...h, "X-CSRF-Token": "wrong" })).status,
    403,
  );
  now += 8 * 3600000 - 1;
  assert.equal((await s.call("/api/state", undefined, h)).status, 200);
  now++;
  assert.equal((await s.call("/api/state", undefined, h)).status, 401);
  const fresh = await s.login();
  assert.notEqual(fresh["X-CSRF-Token"], h["X-CSRF-Token"]);
  assert.equal((await s.call("/api/logout", {}, fresh)).status, 200);
  assert.equal((await s.call("/api/state", undefined, fresh)).status, 401);
});
test("host/origin/CSRF/content/body guards and bounded login attempts", async (t) => {
  const f = await fixture(t),
    s = await f.start(),
    h = await s.login();
  const hostStatus = await new Promise((resolve, reject) =>
    get(s.base + "/", { headers: { Host: "evil.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on("error", reject),
  );
  assert.equal(hostStatus, 403);
  assert.equal(
    (
      await s.call(
        "/api/login",
        { password },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await s.call("/api/action", {}, { ...h, "Sec-Fetch-Site": "cross-site" }))
      .status,
    403,
  );
  assert.equal(
    (await s.call("/api/action", {}, { ...h, "Content-Type": "text/plain" }))
      .status,
    415,
  );
  for (const body of ["invalid", "[]", "null"])
    assert.equal((await s.call("/api/action", body, h)).status, 400);
  assert.equal((await s.call("/api/action", "x".repeat(65537), h)).status, 413);
  for (const path of [
    "/.env",
    "/domain.mjs",
    "/data/workspace.sqlite",
    "/%2e%2e%2fserver.mjs",
  ])
    assert.equal((await s.call(path)).status, 404);
  assert.match(
    (await s.call("/")).headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  for (let n = 0; n < 9; n++)
    assert.equal(
      (await s.call("/api/login", { password: "incorrect" })).status,
      401,
    );
  assert.equal((await s.call("/api/login", { password })).status, 429);
});
test("two servers sharing a database reject stale writes and durable retries survive restart", async (t) => {
  const f = await fixture(t),
    a = await f.start(),
    b = await f.start(),
    ah = await a.login(),
    bh = await b.login();
  const input = request("create", { proposal: sample() });
  const first = await (await a.call("/api/action", input, ah)).json(),
    id = first.proposal.id;
  assert.equal(
    (await b.call("/api/action", request("archive", { id, version: 1 }), bh))
      .status,
    200,
  );
  assert.equal(
    (
      await a.call(
        "/api/action",
        request("save", { id, version: 1, proposal: sample() }),
        ah,
      )
    ).status,
    409,
  );
  a.server.closeAllConnections();
  await new Promise((r) => a.server.close(r));
  const restarted = await f.start(),
    rh = await restarted.login();
  assert.equal((await restarted.call("/api/state", undefined, ah)).status, 401);
  const retry = await (await restarted.call("/api/action", input, rh)).json();
  assert.equal(retry.proposals.length, 1);
  assert.equal(retry.proposal.revisions.length, 2);
  const changed = {
    ...input,
    proposal: { ...input.proposal, name: "Different payload" },
  };
  assert.equal((await restarted.call("/api/action", changed, rh)).status, 409);
});
test("actual SQLite write failures roll back and the same save can be retried", async (t) => {
  const f = await fixture(t),
    s = await f.start(),
    h = await s.login(),
    db = new DatabaseSync(f.file);
  t.after(() => db.close());
  db.exec(
    "CREATE TRIGGER fail_save BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  const input = request("create", { proposal: sample() });
  const failed = await s.call("/api/action", input, h);
  assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes("synthetic failure"));
  assert.equal(
    (await (await s.call("/api/state", undefined, h)).json()).proposals.length,
    0,
  );
  db.exec("DROP TRIGGER fail_save");
  assert.equal((await s.call("/api/action", input, h)).status, 200);
  assert.equal((await s.call("/api/action", input, h)).status, 200);
  assert.equal(
    (await (await s.call("/api/state", undefined, h)).json()).proposals.length,
    1,
  );
});
test("legacy SQLite records migrate unchanged and remain read-only behind authentication", async (t) => {
  const f = await fixture(t),
    db = new DatabaseSync(f.file);
  t.after(() => db.close());
  const record = {
    id: "1b7e2460-1fa7-4bcd-8ff0-50e8e90d90cc",
    name: "Old demo",
    kind: "Website",
    pages: "5",
    care: true,
    estimate: 240000,
  };
  db.exec(
    "CREATE TABLE workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES (1, ?)").run(
    JSON.stringify({ briefs: [record] }),
  );
  const s = await f.start(),
    h = await s.login();
  const migrated = JSON.parse(
    db.prepare("SELECT data FROM workspace").get().data,
  );
  assert.deepEqual(migrated, { format: 2, proposals: [], legacy: [record] });
  assert.equal((await s.call("/api/legacy/" + record.id)).status, 401);
  const exported = await s.call("/api/legacy/" + record.id, undefined, h);
  assert.match(exported.headers.get("content-disposition"), /attachment/);
  assert.deepEqual((await exported.json()).record, record);
  assert.equal(
    (
      await s.call(
        "/api/action",
        request("save", { id: record.id, version: 1, proposal: sample() }),
        h,
      )
    ).status,
    404,
  );
  db.exec(
    "CREATE TRIGGER no_write BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'unexpected write'); END;",
  );
  assert.equal((await s.call("/api/state", undefined, h)).status, 200);
  await f.start();
});
test("authenticated exports are immutable, preserve cents and hide operation receipts", async (t) => {
  const f = await fixture(t),
    s = await f.start(),
    h = await s.login(),
    proposal = sample();
  const first = await (
      await s.call(
        "/api/action",
        request("create", { proposal, totalMinor: 1 }),
        h,
      )
    ).json(),
    id = first.proposal.id;
  assert.equal(first.proposal.revisions[0].totals.totalMinor, 117041);
  assert.equal(
    (
      await s.call(
        "/api/action",
        request("save", {
          id,
          version: 1,
          proposal: { ...proposal, discount: "0" },
        }),
        h,
      )
    ).status,
    200,
  );
  const path = `/api/proposals/${id}/export?format=json&revision=1`;
  assert.equal((await s.call(path)).status, 401);
  const exported = await s.call(path, undefined, h);
  assert.match(
    exported.headers.get("content-disposition"),
    /attachment; filename="studio-[\da-f-]+-r1.json"/,
  );
  const data = await exported.json();
  assert.equal(data.revision, 1);
  assert.equal(data.totals.totalMinor, 117041);
  assert.ok(!JSON.stringify(data).includes('"request"'));
  assert.equal(
    (await s.call(path.replace("revision=1", "revision=99"), undefined, h))
      .status,
    404,
  );
  assert.equal(
    (
      await s.call(path.replace("format=json", "format=html"), undefined, h)
    ).headers.get("content-type"),
    "text/html; charset=utf-8",
  );
});
test("unsupported format startup fails without replacing the database", async (t) => {
  const f = await fixture(t),
    db = new DatabaseSync(f.file);
  t.after(() => db.close());
  const raw = JSON.stringify({ format: 999, proposals: [], preserve: "yes" });
  db.exec(
    "CREATE TABLE workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO workspace VALUES (1, ?)").run(raw);
  assert.throws(
    () => createApplication(f.file, { password }),
    /Unsupported workspace format/,
  );
  assert.equal(db.prepare("SELECT data FROM workspace").get().data, raw);
});
test("workspace byte cap rolls back both the new proposal and its operation receipt", async (t) => {
  const f = await fixture(t),
    s = await f.start(),
    h = await s.login(),
    db = new DatabaseSync(f.file);
  t.after(() => db.close());
  db.prepare("UPDATE workspace SET data=?").run(
    JSON.stringify({
      ...initialState(),
      padding: "x".repeat(10 * 1024 * 1024),
    }),
  );
  const input = request("create", { proposal: sample() });
  assert.equal((await s.call("/api/action", input, h)).status, 409);
  assert.equal(
    JSON.parse(db.prepare("SELECT data FROM workspace").get().data).proposals
      .length,
    0,
  );
  db.prepare("UPDATE workspace SET data=?").run(JSON.stringify(initialState()));
  assert.equal((await s.call("/api/action", input, h)).status, 200);
});
test("no-op save does not create a revision or rewrite SQLite", async (t) => {
  const f = await fixture(t),
    s = await f.start(),
    h = await s.login(),
    proposal = sample();
  const first = await (
    await s.call("/api/action", request("create", { proposal }), h)
  ).json();
  const db = new DatabaseSync(f.file);
  t.after(() => db.close());
  db.exec(
    "CREATE TRIGGER no_write BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'unexpected write'); END;",
  );
  const result = await s.call(
    "/api/action",
    request("save", { id: first.proposal.id, version: 1, proposal }),
    h,
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).proposal.revisions.length, 1);
});
