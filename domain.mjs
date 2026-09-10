import { createHash, randomUUID } from "node:crypto";
import { Problem, calculate, decimal, fixed } from "./public/pricing.js";
export { Problem } from "./public/pricing.js";
const uuid =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
function text(value, label, max, required = true) {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (required && !value.trim()) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
    throw new Problem(
      `${label} must be ${required ? 1 : 0}-${max} characters without control characters.`,
    );
  return value.trim();
}
export function validate(input) {
  const totals = calculate(input),
    ids = new Set();
  const lines = input.lines.map((line, i) => {
    if (typeof line.id !== "string" || !uuid.test(line.id) || ids.has(line.id))
      throw new Problem("Scope lines require unique row IDs.");
    ids.add(line.id);
    return {
      id: line.id,
      description: text(line.description, `Line ${i + 1} description`, 500),
      quantity: fixed(decimal(line.quantity, "Quantity", 10_000_000, 1)),
      unit: line.unit,
      rate: fixed(decimal(line.rate, "Rate", 1_000_000_000)),
    };
  });
  return {
    name: text(input.name, "Project name", 80),
    client: text(input.client ?? "", "Client reference", 160, false),
    author: text(input.author ?? "", "Prepared by", 120, false),
    summary: text(input.summary, "Project objective", 1500),
    assumptions: text(input.assumptions ?? "", "Assumptions", 2000, false),
    exclusions: text(input.exclusions ?? "", "Exclusions", 1500, false),
    terms: text(input.terms ?? "", "Delivery and payment notes", 2000, false),
    currency: input.currency,
    lines,
    discount: fixed(totals.discountMinor),
    taxRate: fixed(totals.taxBasisPoints),
    status: "draft",
  };
}
export function initialState() {
  return { format: 2, proposals: [], legacy: [] };
}
export function migrate(state) {
  if (state.format === 2) return state;
  if (state.format !== undefined || !Array.isArray(state.briefs))
    throw new Error(
      "Unsupported workspace format. Preserve the database and check the application version.",
    );
  return { format: 2, proposals: [], legacy: structuredClone(state.briefs) };
}
export const latest = (proposal) => proposal.revisions.at(-1);
export function getProposal(state, id) {
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Problem("Proposal not found.", 404);
  return proposal;
}
export function listProposals(state) {
  return state.proposals.map((p) => {
    const r = latest(p),
      totals = r.totals;
    return {
      id: p.id,
      version: r.version,
      at: r.at,
      name: r.snapshot.name,
      client: r.snapshot.client,
      currency: r.snapshot.currency,
      totalMinor: totals.totalMinor,
      status: r.snapshot.status,
    };
  });
}
export function publicProposal(proposal) {
  return {
    id: proposal.id,
    revisions: proposal.revisions.map(({ request, ...r }) => r),
  };
}
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
export function act(state, input, now = Date.now()) {
  if (!input || !["create", "save", "archive", "restore"].includes(input.type))
    throw new Problem("Unknown action.");
  if (typeof input.requestId !== "string" || !uuid.test(input.requestId))
    throw new Problem("A unique operation ID is required.");
  const hash = createHash("sha256")
    .update(JSON.stringify(canonical(input)))
    .digest("hex");
  for (const p of state.proposals)
    for (const r of p.revisions)
      if (r.request?.id === input.requestId) {
        if (r.request.hash !== hash)
          throw new Problem(
            "This operation ID was already used for different changes.",
            409,
          );
        return {
          proposal: p,
          changed: false,
          message: `Already saved as revision ${r.version}. Showing the latest saved proposal.`,
        };
      }
  let proposal, snapshot, note;
  if (input.type === "create") {
    if (state.proposals.length >= 200)
      throw new Problem(
        "The workspace limit is 200 proposals. Export and back up before starting a separate workspace.",
        409,
      );
    snapshot = validate(input.proposal);
    proposal = { id: randomUUID(), revisions: [] };
    note = "Proposal created using operator-entered scope and rates.";
  } else {
    proposal = getProposal(state, input.id);
    const current = latest(proposal);
    if (current.version !== input.version)
      throw new Problem(
        "A newer revision exists. Your draft is kept. Review the latest saved proposal before replacing it.",
        409,
      );
    snapshot = structuredClone(current.snapshot);
    if (input.type === "save") {
      if (snapshot.status === "archived")
        throw new Problem(
          "Restore a revision before editing an archived proposal.",
          409,
        );
      const next = validate(input.proposal);
      if (next.currency !== snapshot.currency)
        throw new Problem(
          "Currency is locked after the first save. Start a new proposal and enter its rates; no currency conversion is performed.",
          409,
        );
      if (
        JSON.stringify({ ...snapshot, status: "draft" }) ===
        JSON.stringify(next)
      )
        return { proposal, changed: false, message: "No changes to save." };
      snapshot = next;
      note = text(
        input.note ?? "Scope or pricing revised.",
        "Revision note",
        300,
      );
    } else if (input.type === "archive") {
      if (snapshot.status === "archived")
        throw new Problem("This proposal is already archived.", 409);
      snapshot.status = "archived";
      note = "Archived; all saved revisions retained.";
    } else {
      const source = proposal.revisions.find(
        (r) => r.version === input.sourceVersion,
      );
      if (!source) throw new Problem("Source revision not found.", 404);
      snapshot = { ...structuredClone(source.snapshot), status: "draft" };
      note = `Restored revision ${source.version} as a new draft.`;
    }
  }
  if (proposal.revisions.length >= 50)
    throw new Problem(
      "This proposal has reached its 50-revision limit. Export it before starting a new proposal.",
      409,
    );
  proposal.revisions.push({
    version: proposal.revisions.length + 1,
    at: new Date(now).toISOString(),
    note,
    snapshot,
    calculation: "minor-unit-half-up-v1",
    totals: calculate(snapshot),
    request: { id: input.requestId, hash },
  });
  if (input.type === "create") state.proposals.unshift(proposal);
  return {
    proposal,
    changed: true,
    message: `Revision ${latest(proposal).version} saved locally. No proposal has been sent.`,
  };
}
