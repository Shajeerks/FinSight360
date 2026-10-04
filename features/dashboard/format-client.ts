/**
 * Display-only formatting for chart axes/tooltips on the client.
 * (Financial maths happens on the server with Decimal; charts only receive
 * already-computed values for drawing.)
 */
const full = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function inr(value: number, decimals?: 0): string {
  return decimals === 0 ? whole.format(value) : full.format(value);
}

/** ₹1.2L / ₹3.4Cr style labels for axes. */
export function compactInr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}
