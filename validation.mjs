export function text(value, label, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(label + " is required (max " + max + " characters).");
  return value.trim();
}
export function number(value, label, min, max) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(label + " must be between " + min + " and " + max + ".");
  return value;
}
export function choice(value, choices, label) {
  if (!choices.includes(value))
    throw new Error("Choose a valid " + label + ".");
  return value;
}
export function id() {
  return crypto.randomUUID();
}
export function bounded(list) {
  if (list.length >= 200)
    throw new Error("This demo is limited to 200 saved items.");
}
