import { text, choice, id, bounded } from "./validation.mjs";
export const prices = {
  Website: 180000,
  "Web application": 650000,
  "Mobile experience": 900000,
};
export function initialState() {
  return { briefs: [] };
}
export const testAction = {
  type: "estimate",
  name: "Demo project",
  kind: "Website",
  pages: "5",
  care: true,
};
export function act(state, input) {
  if (input.type !== "estimate") throw new Error("Unknown action.");
  bounded(state.briefs);
  const name = text(input.name, "Project name", 80),
    kind = choice(input.kind, Object.keys(prices), "project type"),
    pages = choice(input.pages, ["5", "10", "20"], "size");
  if (typeof input.care !== "boolean")
    throw new Error("Choose support preference.");
  const estimate =
    prices[kind] + (Number(pages) - 5) * 15000 + (input.care ? 60000 : 0);
  state.briefs.unshift({
    id: id(),
    name,
    kind,
    pages,
    care: input.care,
    estimate,
  });
  return "Illustrative estimate saved. This is not a commercial quote.";
}
