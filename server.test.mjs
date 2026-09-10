import { test } from "node:test";
import { get } from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "./server.mjs";
import { initialState, act, testAction } from "./domain.mjs";
test("domain rejects unknown actions without changing state", () => {
  const data = initialState(),
    before = JSON.stringify(data);
  assert.throws(() => act(data, { type: "no-such-action" }));
  assert.equal(JSON.stringify(data), before);
});
test("domain accepts a valid workflow", () => {
  const data = initialState();
  assert.equal(typeof act(data, testAction), "string");
  assert.notDeepEqual(data, initialState());
});
test("HTTP persistence, CSRF, host checks, errors and static isolation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showcase-")),
    file = join(dir, "db.sqlite");
  let server;
  async function start() {
    server = createApplication(file);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return "http://127.0.0.1:" + server.address().port;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    let base = await start();
    const initial = await (await fetch(base + "/api/state")).json();
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
    const headers = {
      "Content-Type": "application/json",
      "X-CSRF-Token": initial.csrf,
    };
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers,
          body: "invalid",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers,
          body: JSON.stringify({ type: "invalid" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/action", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...testAction, noise: "x".repeat(17000) }),
        })
      ).status,
      413,
    );
    const saved = await fetch(base + "/api/action", {
      method: "POST",
      headers,
      body: JSON.stringify(testAction),
    });
    assert.equal(saved.status, 200);
    const after = await saved.json();
    assert.equal((await fetch(base + "/domain.mjs")).status, 404);
    assert.equal((await fetch(base + "/.env")).status, 404);
    const untrusted = await new Promise((resolve, reject) => {
      get(base + "/", { headers: { Host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on("error", reject);
    });
    assert.equal(untrusted, 403);
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.ok(
      page.headers.get("content-security-policy").includes("script-src 'self'"),
    );
    await stop();
    base = await start();
    const restarted = await (await fetch(base + "/api/state")).json();
    assert.deepEqual(restarted.state, after.state);
    assert.notEqual(restarted.csrf, initial.csrf);
  } finally {
    if (server?.listening) await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
