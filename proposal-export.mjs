import { Problem } from "./domain.mjs";
import { money } from "./public/pricing.js";
const e = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const md = (value) =>
  e(value)
    .replace(/([\\`*_{}\[\]()#+.!|~>-])/g, "\\$1")
    .replace(/\r?\n/g, "  \n");
export const arithmeticNote =
  "Amounts use two minor-unit decimal places. Each quantity x rate is rounded half up to one minor unit before summing. A fixed discount is subtracted from the subtotal. The operator-entered tax percentage is then applied to that discounted subtotal and rounded half up. No currency conversion, tax advice or jurisdiction-specific invoicing is provided.";
export function exportProposal(proposal, version, format) {
  const r = proposal.revisions.find((r) => r.version === version);
  if (!r) throw new Problem("Revision not found.", 404);
  if (!["json", "markdown", "html"].includes(format))
    throw new Problem("Choose JSON, Markdown or HTML.");
  const data = r.snapshot,
    totals = r.totals;
  const warning =
    "Local draft for review. Rates, quantities, assumptions and tax are entered by the operator. This is not a signed agreement, invoice, payment request or proof of delivery. Nothing has been sent.";
  const sections = [
    ["Prepared for", data.client],
    ["Prepared by", data.author],
    ["Project objective", data.summary],
    ["Assumptions", data.assumptions],
    ["Not included", data.exclusions],
    ["Delivery and payment notes", data.terms],
  ];
  const amounts = [
    ["Subtotal", totals.subtotalMinor],
    ["Discount (subtract)", totals.discountMinor],
    ["After discount", totals.taxableMinor],
    [`Tax (${data.taxRate}%)`, totals.taxMinor],
    ["Total", totals.totalMinor],
  ];
  if (format === "json")
    return {
      ext: "json",
      type: "application/json; charset=utf-8",
      body:
        JSON.stringify(
          {
            format: "studio-proposal-v1",
            proposalId: proposal.id,
            revision: version,
            savedAt: r.at,
            calculation: r.calculation,
            note: r.note,
            warning,
            arithmeticNote,
            snapshot: data,
            totals,
          },
          null,
          2,
        ) + "\n",
    };
  if (format === "markdown")
    return {
      ext: "md",
      type: "text/markdown; charset=utf-8",
      body: `# ${md(data.name)}\n\nRevision ${version} / ${data.status} / ${r.at}\n\n${warning}\n\n${sections.map(([label, value]) => `## ${label}\n\n${md(value || "Not specified")}\n`).join("\n")}\n## Scope & pricing (${data.currency})\n\n${data.lines.map((line, i) => `${i + 1}. ${md(line.description)}\n\n   ${line.quantity} ${line.unit} x ${money(Number(line.rate.replace(".", "")), data.currency)} = ${money(totals.lineTotalsMinor[i], data.currency)}`).join("\n\n")}\n\n${amounts.map(([label, value]) => `- ${label}: ${money(value, data.currency)}`).join("\n")}\n\n${arithmeticNote}\n`,
    };
  return {
    ext: "html",
    type: "text/html; charset=utf-8",
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(data.name)} | Studio proposal</title><link rel="stylesheet" href="/proposal.css"></head><body><header><p>BILLIONCODES / PROPOSAL DESK</p><h1>${e(data.name)}</h1><p>Revision ${version} / ${e(data.status)} / ${e(r.at)}</p></header><main><aside>${warning}</aside><p>Use your browser's Print command to print or save a PDF. This is the selected saved revision, not an unsaved editor draft.</p>${sections
      .slice(0, 3)
      .map(
        ([label, value]) =>
          `<section><h2>${label}</h2><p class="multiline">${e(value || "Not specified")}</p></section>`,
      )
      .join(
        "",
      )}<section><h2>Scope &amp; pricing / ${data.currency}</h2><div class="table-wrap"><table><caption>Operator-entered line items</caption><thead><tr><th scope="col">Scope</th><th scope="col">Quantity</th><th scope="col">Rate</th><th scope="col">Amount</th></tr></thead><tbody>${data.lines.map((line, i) => `<tr><th scope="row">${e(line.description)}</th><td>${line.quantity} ${line.unit}</td><td>${money(Number(line.rate.replace(".", "")), data.currency)}</td><td>${money(totals.lineTotalsMinor[i], data.currency)}</td></tr>`).join("")}</tbody></table></div><dl>${amounts.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${money(value, data.currency)}</dd></div>`).join("")}</dl></section>${sections
      .slice(3)
      .map(
        ([label, value]) =>
          `<section><h2>${label}</h2><p class="multiline">${e(value || "Not specified")}</p></section>`,
      )
      .join(
        "",
      )}<aside>${arithmeticNote}</aside></main><footer>Proposal ${e(proposal.id)} / ${e(r.note)}</footer></body></html>`,
  };
}
