/** Client-safe display formatters. */

const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function rupees(n: number): string {
  return `₹${inr2.format(n)}`;
}

export function plain(n: number): string {
  return inr2.format(n);
}

export function signedPct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}
