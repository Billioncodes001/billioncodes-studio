import { $, escape as e, api, notice, setToken } from "./core.js";
import { calculate, money, units } from "./pricing.js";
let proposals = [],
  legacy = [],
  selected = null,
  baseVersion = null,
  dirty = false,
  busy = false,
  pending = null;
const names = [
  "name",
  "client",
  "author",
  "summary",
  "assumptions",
  "exclusions",
  "terms",
  "currency",
  "discount",
  "taxRate",
];
const field = (name) => $("#proposal-form").elements.namedItem(name);
const current = () => selected?.revisions.at(-1);
const freshLine = () => ({
  id: crypto.randomUUID(),
  description: "",
  quantity: "1.00",
  unit: "hour",
  rate: "",
});
const blank = () => ({
  name: "",
  client: "",
  author: "",
  summary: "",
  assumptions: "",
  exclusions: "",
  terms: "",
  currency: "NGN",
  discount: "0.00",
  taxRate: "0.00",
  lines: [freshLine()],
});
function lineMarkup(line, i) {
  return `<article class="scope-line" data-id="${e(line.id)}"><div class="line-heading"><span>LINE ${String(i + 1).padStart(2, "0")}</span><button type="button" data-remove aria-label="Remove scope line ${i + 1}">Remove</button></div><label>Scope line ${i + 1}<textarea data-field="description" required maxlength="500" placeholder="A concrete deliverable, not just a phase name">${e(line.description)}</textarea></label><div class="line-numbers"><label>Quantity ${i + 1}<input data-field="quantity" value="${e(line.quantity)}" inputmode="decimal" required maxlength="10" /></label><label>Unit ${i + 1}<select data-field="unit">${units.map((unit) => `<option${line.unit === unit ? " selected" : ""}>${unit}</option>`).join("")}</select></label><label>Rate ${i + 1}<input data-field="rate" value="${e(line.rate)}" inputmode="decimal" placeholder="Your rate" required maxlength="13" /></label><div class="line-amount"><span>AMOUNT</span><output data-amount>Incomplete</output></div></div></article>`;
}
function readLines() {
  return [...document.querySelectorAll(".scope-line")].map((row) => ({
    id: row.dataset.id,
    ...Object.fromEntries(
      [...row.querySelectorAll("[data-field]")].map((input) => [
        input.dataset.field,
        input.value,
      ]),
    ),
  }));
}
function draft() {
  return {
    ...Object.fromEntries(names.map((name) => [name, field(name).value])),
    lines: readLines(),
  };
}
function amountList(totals, caption = "Editor total") {
  return `<dl>${[
    ["Subtotal", totals.subtotalMinor],
    ["Discount", totals.discountMinor],
    ["After discount", totals.taxableMinor],
    ["Tax", totals.taxMinor],
  ]
    .map(
      ([label, value]) =>
        `<div><dt>${label}</dt><dd>${money(value, totals.currency)}</dd></div>`,
    )
    .join(
      "",
    )}</dl><div class="grand-total"><span>${caption}</span><strong>${money(totals.totalMinor, totals.currency)}</strong></div>`;
}
function preview() {
  try {
    const totals = calculate(draft());
    $("#totals").innerHTML = amountList(totals);
    [...document.querySelectorAll("[data-amount]")].forEach((el, i) => {
      el.textContent = money(totals.lineTotalsMinor[i], totals.currency);
    });
  } catch (error) {
    $("#totals").innerHTML = `<p class="pricing-error">${e(error.message)}</p>`;
    document.querySelectorAll("[data-amount]").forEach((el) => {
      el.textContent = "Incomplete";
    });
  }
}
function controls() {
  const archived = current()?.snapshot.status === "archived";
  $("#paper-fields").disabled = Boolean(archived);
  for (const name of ["discount", "taxRate", "note"])
    field(name).disabled = Boolean(archived);
  field("currency").disabled = Boolean(selected);
  $("#save").disabled = Boolean(archived);
  $("#add-line").disabled = readLines().length >= 30;
  $("#archive").disabled = dirty || Boolean(archived);
  $("#restore").disabled = dirty;
  $("#draft-state").textContent = dirty
    ? "Unsaved changes. Save before archiving or restoring another revision."
    : selected
      ? `Editing saved revision ${baseVersion}. Exports use saved revisions only.`
      : "Your rates. Your scope. No invented price list.";
}
function changed() {
  dirty = true;
  controls();
  preview();
}
function shelf() {
  const query = $("#search").value.trim().toLowerCase(),
    filter = $("#filter").value;
  const visible = proposals.filter(
    (p) =>
      `${p.name} ${p.client}`.toLowerCase().includes(query) &&
      (filter === "all" ||
        (filter === "archived"
          ? p.status === "archived"
          : p.status !== "archived")),
  );
  $("#proposals").innerHTML = visible.length
    ? visible
        .map(
          (p) =>
            `<button class="proposal-card${selected?.id === p.id ? " selected" : ""}" type="button" data-open="${e(p.id)}"${selected?.id === p.id ? ' aria-current="true"' : ""}><span>${e(p.status)} / R${p.version}</span><strong>${e(p.name)}</strong><small>${e(p.client || "No client reference")}</small><b>${money(p.totalMinor, p.currency)}</b></button>`,
        )
        .join("")
    : '<p class="empty-shelf">No proposals here yet. Start with one clear deliverable.</p>';
  $("#legacy-panel").hidden = !legacy.length;
  $("#legacy").innerHTML = legacy
    .map(
      (record) =>
        `<article><h4>${e(record.name)}</h4><p>${e(record.kind)} / ${e(record.pages)} screens / ${record.care ? "With" : "Without"} fictional support</p><p>Original illustration: ${Number.isSafeInteger(record.estimate) && record.estimate >= 0 ? money(record.estimate * 100, "NGN") : "See original record"}</p><a href="/api/legacy/${encodeURIComponent(record.id)}">Download original record (JSON)</a></article>`,
    )
    .join("");
}
const labels = {
  name: "Project",
  client: "Prepared for",
  author: "Prepared by",
  summary: "Objective",
  lines: "Scope and rates",
  currency: "Currency",
  discount: "Fixed discount",
  taxRate: "Tax percentage",
  assumptions: "Assumptions",
  exclusions: "Not included",
  terms: "Delivery and payment notes",
  status: "Status",
};
function display(key, value) {
  return key === "lines"
    ? value
        .map(
          (line, i) =>
            `${i + 1}. ${line.description}\n${line.quantity} ${line.unit} x ${line.rate}`,
        )
        .join("\n\n")
    : value || "Not specified";
}
function history() {
  if (!selected) return;
  const revision =
    selected.revisions.find(
      (r) => r.version === Number($("#revision").value),
    ) || current();
  $("#revision-note").textContent =
    `${new Date(revision.at).toLocaleString()} / ${revision.note}`;
  $("#snapshot").innerHTML =
    Object.entries(labels)
      .map(
        ([k, label]) =>
          `<section class="snapshot-field"><h5>${label}</h5><p>${e(display(k, revision.snapshot[k]))}</p></section>`,
      )
      .join("") + amountList(revision.totals, "Selected saved total");
  const changes = Object.keys(labels).filter(
    (k) =>
      JSON.stringify(revision.snapshot[k]) !==
      JSON.stringify(current().snapshot[k]),
  );
  const delta = current().totals.totalMinor - revision.totals.totalMinor;
  $("#comparison").innerHTML =
    `<p class="delta">Total change, selected R${revision.version} to latest R${current().version}: ${delta < 0 ? "-" : "+"}${money(Math.abs(delta), revision.snapshot.currency)}</p>` +
    (changes.length
      ? changes
          .map(
            (k) =>
              `<article class="diff"><h5>${labels[k]}</h5><div><section><h6>Selected / R${revision.version}</h6><p>${e(display(k, revision.snapshot[k]))}</p></section><section><h6>Latest / R${current().version}</h6><p>${e(display(k, current().snapshot[k]))}</p></section></div></article>`,
          )
          .join("")
      : "<p>No differences from the latest saved proposal.</p>");
  for (const [name, format] of [
    ["print", "html"],
    ["markdown", "markdown"],
    ["json", "json"],
  ])
    $("#export-" + name).href =
      `/api/proposals/${selected.id}/export?revision=${revision.version}&format=${format}`;
}
function savedDetails() {
  $("#history-panel").hidden = !selected;
  if (!selected) {
    for (const id of ["revision", "revision-note", "snapshot", "comparison"])
      $("#" + id).replaceChildren();
    for (const name of ["print", "markdown", "json"])
      $("#export-" + name).removeAttribute("href");
    return;
  }
  $("#document-name").textContent = current().snapshot.name;
  $("#stamp").textContent =
    `${current().snapshot.status.toUpperCase()} / REVISION ${current().version}`;
  $("#revision").innerHTML = [...selected.revisions]
    .reverse()
    .map(
      (r) =>
        `<option value="${r.version}">Revision ${r.version} / ${e(r.snapshot.status)}</option>`,
    )
    .join("");
  history();
}
function editor(proposal) {
  selected = proposal;
  baseVersion = current()?.version ?? null;
  dirty = false;
  pending = null;
  const data = current()?.snapshot || blank();
  for (const name of names) field(name).value = data[name];
  field("note").value = "";
  $("#lines").innerHTML = data.lines.map(lineMarkup).join("");
  $("#document-name").textContent = "The next useful thing.";
  $("#stamp").textContent = "NOT YET SAVED";
  $("#conflict").hidden = true;
  savedDetails();
  shelf();
  controls();
  preview();
}
function discard() {
  return (
    !dirty ||
    confirm(
      "Replace the unsaved editor? Unsaved changes will be lost; saved revisions remain.",
    )
  );
}
function locked(message) {
  setToken(undefined);
  $("#desk").hidden = true;
  $("#access").hidden = false;
  $("#unlocked-message").hidden = true;
  $("#login-form").hidden = false;
  $("#access-message").textContent = message;
}
async function task(run) {
  if (busy) return;
  busy = true;
  const elements = [
    ...document.querySelectorAll("button,input,select,textarea"),
  ].map((el) => [el, el.disabled]);
  for (const [el] of elements) el.disabled = true;
  try {
    await run();
  } catch (error) {
    notice(error.message, true);
    if ((error.status === 401 || error.status === 403) && !$("#desk").hidden)
      locked(
        "Session ended or changed. Unlock again; your editor draft is kept in this tab.",
      );
    if (error.status === 409 && selected) $("#conflict").hidden = false;
  } finally {
    for (const [el, disabled] of elements)
      if (el.isConnected) el.disabled = disabled;
    busy = false;
    controls();
  }
}
async function access() {
  const session = await api("/api/session");
  $("#retry").hidden = true;
  if (session.authenticated) {
    setToken(session.csrf);
    const data = await api("/api/state");
    proposals = data.proposals;
    legacy = data.legacy;
    $("#desk").hidden = false;
    $("#access").hidden = true;
    $("#unlocked-message").hidden = false;
    shelf();
  } else if (!session.configured) {
    $("#access-message").textContent =
      "Setup required: set STUDIO_PASSWORD (at least 16 characters) in this project's .env, then restart the server. Saved proposals remain locked. See the repository README.";
    $("#login-form").hidden = true;
    $("#retry").hidden = false;
  } else
    locked(
      "Unlock this machine's private proposal desk. Sessions expire after eight hours or a server restart.",
    );
}
async function command(payload) {
  const signature = JSON.stringify(payload);
  // Keep the operation ID after an ambiguous response; a changed draft gets a new one.
  if (pending?.signature !== signature)
    pending = { signature, requestId: crypto.randomUUID() };
  const response = await api("/api/action", {
    ...payload,
    requestId: pending.requestId,
  });
  proposals = response.proposals;
  editor(response.proposal);
  notice(response.message);
}
$("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const password = event.target.elements.password.value;
  task(async () => {
    await api("/api/login", { password });
    event.target.reset();
    await access();
    notice("Proposal desk unlocked. All documents remain local.");
  });
});
$("#retry").addEventListener("click", () => task(access));
$("#lock").addEventListener("click", () =>
  task(async () => {
    if (!discard()) return;
    await api("/api/logout", {});
    proposals = [];
    legacy = [];
    editor(null);
    locked("The desk is locked. Enter the password to continue.");
    notice("Proposal desk locked.");
  }),
);
$("#search").addEventListener("input", shelf);
$("#filter").addEventListener("change", shelf);
$("#new").addEventListener("click", () => {
  if (!busy && discard()) {
    editor(null);
    field("name").focus();
  }
});
$("#proposals").addEventListener("click", (event) => {
  const button = event.target.closest("[data-open]");
  if (button)
    task(async () => {
      if (discard())
        editor((await api("/api/proposals/" + button.dataset.open)).proposal);
    });
});
$("#proposal-form").addEventListener("input", changed);
$("#proposal-form").addEventListener("change", changed);
$("#add-line").addEventListener("click", () => {
  $("#lines").insertAdjacentHTML(
    "beforeend",
    lineMarkup(freshLine(), readLines().length),
  );
  changed();
  $("#lines").lastElementChild.querySelector("textarea").focus();
});
$("#lines").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button || busy) return;
  const row = button.closest(".scope-line");
  if (
    (row.querySelector("textarea").value.trim() ||
      row.querySelector('[data-field="rate"]').value.trim()) &&
    !confirm(
      "Remove this scope line from the draft? Saved revisions keep their original scope.",
    )
  )
    return;
  row.remove();
  $("#lines").innerHTML = readLines().map(lineMarkup).join("");
  changed();
  $("#add-line").focus();
});
$("#proposal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const proposal = draft(),
    note = field("note").value.trim() || "Scope or pricing revised.";
  task(() =>
    command(
      selected
        ? {
            type: "save",
            id: selected.id,
            version: baseVersion,
            proposal,
            note,
          }
        : { type: "create", proposal },
    ),
  );
});
$("#revision").addEventListener("change", history);
$("#archive").addEventListener("click", () =>
  task(async () => {
    if (confirm("Archive this proposal? All saved revisions remain available."))
      await command({ type: "archive", id: selected.id, version: baseVersion });
  }),
);
$("#restore").addEventListener("click", () =>
  task(async () => {
    const sourceVersion = Number($("#revision").value);
    if (
      confirm(
        `Restore revision ${sourceVersion} as a new draft? No saved revision will be deleted.`,
      )
    )
      await command({
        type: "restore",
        id: selected.id,
        version: baseVersion,
        sourceVersion,
      });
  }),
);
$("#review").addEventListener("click", () =>
  task(async () => {
    selected = (await api("/api/proposals/" + selected.id)).proposal;
    savedDetails();
    shelf();
    notice(
      "Latest saved history loaded. Your editor and its original revision number are unchanged.",
    );
  }),
);
$("#replace").addEventListener("click", () =>
  task(async () => {
    if (discard())
      editor((await api("/api/proposals/" + selected.id)).proposal);
  }),
);
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
editor(null);
task(async () => {
  try {
    await access();
  } catch (error) {
    $("#access-message").textContent = error.message;
    $("#retry").hidden = false;
    throw error;
  }
});
