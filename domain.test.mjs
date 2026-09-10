import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, act, testAction } from "./domain.mjs";
test("estimate is server derived with bounded options", () => {
  const s = initialState();
  act(s, { ...testAction, estimate: 1 });
  assert.equal(s.briefs[0].estimate, 240000);
  act(s, { ...testAction, pages: "10", care: false });
  assert.equal(s.briefs[0].estimate, 255000);
  for (const input of [
    { pages: "999" },
    { kind: "Unknown" },
    { care: "true" },
    { name: " " },
  ])
    assert.throws(() => act(s, { ...testAction, ...input }));
});
