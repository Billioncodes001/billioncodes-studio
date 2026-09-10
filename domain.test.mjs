import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  decimal,
  money,
  MAX_TOTAL_MINOR,
} from "./public/pricing.js";
import {
  initialState,
  migrate,
  act,
  latest,
  publicProposal,
} from "./domain.mjs";
import { exportProposal } from "./proposal-export.mjs";
import { sample, request } from "./fixtures.mjs";
const create = (state, data = sample()) =>
  act(state, request("create", { proposal: data })).proposal;
test("pricing uses operator rates and exact line, discount and tax totals", () => {
  const totals = calculate(sample());
  assert.deepEqual(totals, {
    currency: "NGN",
    lineTotalsMinor: [31375, 80000],
    subtotalMinor: 111375,
    discountMinor: 2500,
    taxableMinor: 108875,
    taxBasisPoints: 750,
    taxMinor: 8166,
    totalMinor: 117041,
  });
  assert.equal(money(totals.totalMinor, "NGN"), "NGN 1,170.41");
  for (const currency of ["NGN", "USD", "GBP", "EUR"])
    assert.equal(calculate(sample({ currency })).totalMinor, 117041);
});
test("line rounding is half up before summing, tax is rounded after discount", () => {
  const input = sample({
    discount: "0",
    taxRate: "50",
    lines: sample().lines.map((l) => ({
      ...l,
      quantity: "0.50",
      rate: "0.01",
    })),
  });
  assert.deepEqual(calculate(input).lineTotalsMinor, [1, 1]);
  assert.equal(calculate(input).totalMinor, 3);
  input.discount = "0.01";
  assert.equal(calculate(input).taxMinor, 1);
  assert.equal(calculate(input).totalMinor, 2);
  input.lines[0].quantity = "0.49";
  input.discount = "0";
  assert.equal(calculate(input).lineTotalsMinor[0], 0);
});
test("decimal parsing rejects coercion, extra precision, signs, blanks, grouping and exponents", () => {
  for (const value of [
    null,
    1.23,
    "",
    " ",
    "1e3",
    "1,000",
    "0.001",
    "-0",
    "+1",
    "Infinity",
    "NaN",
    "00.5",
    "1.",
    ".5",
    "1\n2",
    "99999999999",
  ])
    assert.throws(() => decimal(value, "Amount", MAX_TOTAL_MINOR));
  assert.equal(decimal(" 1.2 ", "Amount", 1000), 120);
  assert.equal(decimal("0.01", "Amount", 1000), 1);
  assert.throws(() => decimal("0", "Quantity", 1000, 1));
});
test("blank is not a free rate; discount, currency and amount bounds are enforced", () => {
  const input = sample();
  input.lines[0].rate = "";
  assert.throws(() => calculate(input));
  input.lines.forEach((l) => {
    l.rate = "0";
  });
  input.discount = "0";
  assert.equal(calculate(input).totalMinor, 0);
  for (const changes of [
    { discount: "2000" },
    { taxRate: "100.01" },
    { currency: "JPY" },
    { lines: [] },
    { lines: Array(31).fill(sample().lines[0]) },
  ])
    assert.throws(() => calculate(sample(changes)));
  const big = sample({
    discount: "0",
    taxRate: "0",
    lines: [{ ...sample().lines[0], quantity: "100000", rate: "10000000" }],
  });
  assert.throws(() => calculate(big));
  big.lines[0].quantity = "100";
  assert.equal(calculate(big).totalMinor, MAX_TOTAL_MINOR);
  big.taxRate = "0.01";
  assert.throws(() => calculate(big));
});
test("randomized decimal cases match an independent rational-integer oracle", () => {
  let seed = 41;
  const rand = (max) => {
    seed = (seed * 16807) % 2147483647;
    return seed % max;
  };
  const asDecimal = (n) =>
    `${Math.trunc(n / 100)}.${String(n % 100).padStart(2, "0")}`;
  for (let i = 0; i < 500; i++) {
    const quantity = 1 + rand(100000),
      rate = rand(1000000),
      tax = rand(10001);
    const rounded = Number(
      (BigInt(quantity) * BigInt(rate)) / 100n +
        ((BigInt(quantity) * BigInt(rate)) % 100n >= 50n ? 1n : 0n),
    );
    const discount = rand(rounded + 1),
      taxable = rounded - discount;
    const taxResult = Number(
      (BigInt(taxable) * BigInt(tax)) / 10000n +
        ((BigInt(taxable) * BigInt(tax)) % 10000n >= 5000n ? 1n : 0n),
    );
    const input = sample({
      lines: [
        {
          ...sample().lines[0],
          quantity: asDecimal(quantity),
          rate: asDecimal(rate),
        },
      ],
      discount: asDecimal(discount),
      taxRate: asDecimal(tax),
    });
    assert.equal(calculate(input).totalMinor, taxable + taxResult);
  }
});
test("all input validates before mutation and client totals are ignored", () => {
  const state = initialState();
  for (const changes of [
    { name: " " },
    { summary: "" },
    { name: "x".repeat(81) },
    { assumptions: "x\0y" },
    { lines: [{ ...sample().lines[0], id: "invalid" }] },
  ]) {
    assert.throws(() => create(state, sample(changes)));
    assert.equal(state.proposals.length, 0);
  }
  const duplicate = sample();
  duplicate.lines[1].id = duplicate.lines[0].id;
  assert.throws(() => create(state, duplicate));
  const p = create(
    state,
    sample({ totals: { totalMinor: 1 }, status: "paid" }),
  );
  assert.equal(latest(p).totals.totalMinor, 117041);
  assert.equal(latest(p).snapshot.status, "draft");
  assert.equal(latest(p).calculation, "minor-unit-half-up-v1");
});
test("save normalizes decimals, stores immutable totals and cannot relabel currency", () => {
  const state = initialState(),
    input = sample(),
    p = create(state, input),
    original = structuredClone(latest(p));
  const normalized = structuredClone(input);
  normalized.lines[1].rate = "800";
  assert.equal(
    act(state, request("save", { id: p.id, version: 1, proposal: normalized }))
      .changed,
    false,
  );
  assert.throws(
    () =>
      act(
        state,
        request("save", {
          id: p.id,
          version: 1,
          proposal: { ...input, currency: "USD" },
        }),
      ),
    { status: 409 },
  );
  const revised = structuredClone(input);
  revised.lines[1].rate = "900.00";
  act(
    state,
    request("save", {
      id: p.id,
      version: 1,
      proposal: revised,
      note: "Expanded prototype scope.",
    }),
  );
  assert.equal(latest(p).totals.totalMinor, 127791);
  assert.deepEqual(p.revisions[0], original);
});
test("stale updates and changed-payload retries cannot replace newer work", () => {
  const state = initialState(),
    input = request("create", { proposal: sample() }),
    p = act(state, input).proposal;
  assert.equal(act(state, JSON.parse(JSON.stringify(input))).changed, false);
  assert.equal(state.proposals.length, 1);
  assert.throws(() => act(state, { ...input, proposal: sample() }), {
    status: 409,
  });
  act(state, request("archive", { id: p.id, version: 1 }));
  assert.throws(
    () =>
      act(state, request("save", { id: p.id, version: 1, proposal: sample() })),
    { status: 409 },
  );
  assert.equal(latest(act(state, input).proposal).version, 2);
});
test("archive and restore append history; legacy records are never edited or reassigned", () => {
  const old = {
    briefs: [
      {
        id: "legacy-id",
        name: "Old demo",
        kind: "Website",
        pages: "5",
        care: true,
        estimate: 240000,
      },
    ],
  };
  const state = migrate(old);
  assert.deepEqual(state.legacy, old.briefs);
  assert.deepEqual(state.proposals, []);
  assert.equal(migrate(state), state);
  assert.throws(() => migrate({ format: 99, briefs: [] }));
  const p = create(state),
    original = structuredClone(latest(p));
  act(state, request("archive", { id: p.id, version: 1 }));
  assert.throws(
    () =>
      act(state, request("save", { id: p.id, version: 2, proposal: sample() })),
    { status: 409 },
  );
  act(state, request("restore", { id: p.id, version: 2, sourceVersion: 1 }));
  assert.equal(latest(p).snapshot.status, "draft");
  assert.deepEqual(latest(p).totals, original.totals);
  assert.deepEqual(p.revisions[0], original);
  assert.deepEqual(state.legacy, old.briefs);
  assert.throws(
    () =>
      act(
        state,
        request("save", { id: "legacy-id", version: 1, proposal: sample() }),
      ),
    { status: 404 },
  );
});
test("record and revision limits never partially mutate state", () => {
  const state = initialState(),
    p = create(state);
  for (let version = 1; version < 50; version++)
    act(state, request("restore", { id: p.id, version, sourceVersion: 1 }));
  const before = JSON.stringify(state);
  assert.equal(
    act(
      state,
      request("save", { id: p.id, version: 50, proposal: latest(p).snapshot }),
    ).changed,
    false,
  );
  assert.throws(
    () => act(state, request("archive", { id: p.id, version: 50 })),
    { status: 409 },
  );
  assert.equal(JSON.stringify(state), before);
  state.proposals = Array(200).fill(p);
  assert.throws(() => create(state), { status: 409 });
});
test("exports select saved revisions, preserve cents and escape executable content", () => {
  const state = initialState(),
    input = sample({
      name: '<script>alert("x")</script>',
      terms: "[Click](javascript:alert(1))\n<img src=x onerror=alert(1)>",
    }),
    p = create(state, input);
  act(
    state,
    request("save", {
      id: p.id,
      version: 1,
      proposal: { ...input, name: "Renamed", discount: "0" },
    }),
  );
  const html = exportProposal(p, 1, "html").body,
    markdown = exportProposal(p, 1, "markdown").body,
    json = JSON.parse(exportProposal(p, 1, "json").body);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("NGN 1,170.41"));
  assert.ok(markdown.includes("\\[Click\\]\\("));
  assert.equal(json.snapshot.name, input.name);
  assert.equal(json.totals.totalMinor, 117041);
  assert.equal(json.revision, 1);
  assert.equal(json.calculation, "minor-unit-half-up-v1");
  assert.ok(!JSON.stringify(publicProposal(p)).includes('"request"'));
  assert.ok(!exportProposal(p, 1, "json").body.includes('"request"'));
  assert.throws(() => exportProposal(p, 9, "json"), { status: 404 });
  assert.throws(() => exportProposal(p, 1, "zip"));
});
