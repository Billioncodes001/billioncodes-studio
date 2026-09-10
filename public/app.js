import { init, form, action, $, escape, money } from "./core.js";
init((state) => {
  $("#estimates").innerHTML = state.briefs
    .slice(0, 5)
    .map(
      (b) =>
        '<article class="estimate"><span>' +
        escape(b.name) +
        " / " +
        escape(b.kind) +
        "</span><strong>" +
        money(b.estimate) +
        "</strong><small>Illustration only: base + extra screens + optional support. Not a quote.</small></article>",
    )
    .join("");
});
form("#estimate-form", async (data) => {
  await action({ type: "estimate", ...data, care: data.care === "on" });
});
