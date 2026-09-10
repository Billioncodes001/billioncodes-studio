export class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const currencies = ["NGN", "USD", "GBP", "EUR"];
export const units = ["hour", "day", "item", "milestone"];
export const MAX_TOTAL_MINOR = 100_000_000_000;
export function decimal(value, label, max, min = 0) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value.trim())
  )
    throw new Problem(
      `${label}: use a plain decimal with at most two decimal places (no commas, signs or exponent notation).`,
    );
  const [whole, fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor < min || minor > max)
    throw new Problem(
      `${label} must be between ${fixed(min)} and ${fixed(max)}.`,
    );
  return minor;
}
export const fixed = (value) =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
export const money = (minor, currency) =>
  `${currency} ${Math.floor(minor / 100).toLocaleString("en-GB")}.${String(minor % 100).padStart(2, "0")}`;
export function calculate(input) {
  if (!input || !currencies.includes(input.currency))
    throw new Problem("Choose a supported currency.");
  if (
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 30
  )
    throw new Problem("Include between 1 and 30 scope lines.");
  const lineTotalsMinor = input.lines.map((line, i) => {
    if (!line || !units.includes(line.unit))
      throw new Problem(`Line ${i + 1}: choose a unit.`);
    const quantity = decimal(
      line.quantity,
      `Line ${i + 1} quantity`,
      10_000_000,
      1,
    );
    const rate = decimal(line.rate, `Line ${i + 1} rate`, 1_000_000_000);
    // Round each line half up to one minor unit before summing. BigInt avoids intermediate overflow.
    const total = (BigInt(quantity) * BigInt(rate) + 50n) / 100n;
    if (total > BigInt(MAX_TOTAL_MINOR))
      throw new Problem(`Line ${i + 1} exceeds the local amount limit.`);
    return Number(total);
  });
  const subtotalMinor = lineTotalsMinor.reduce((sum, line) => sum + line, 0);
  if (subtotalMinor > MAX_TOTAL_MINOR)
    throw new Problem("Subtotal exceeds the local amount limit.");
  const discountMinor = decimal(input.discount, "Discount", subtotalMinor);
  const taxBasisPoints = decimal(input.taxRate, "Tax percentage", 10000);
  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Number(
    (BigInt(taxableMinor) * BigInt(taxBasisPoints) + 5000n) / 10000n,
  );
  const totalMinor = taxableMinor + taxMinor;
  if (totalMinor > MAX_TOTAL_MINOR)
    throw new Problem("Total exceeds the local amount limit.");
  return {
    currency: input.currency,
    lineTotalsMinor,
    subtotalMinor,
    discountMinor,
    taxableMinor,
    taxBasisPoints,
    taxMinor,
    totalMinor,
  };
}
