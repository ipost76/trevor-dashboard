/**
 * Centralized number formatting for TREVOR Hub.
 * All prices and percentages displayed to users go through these functions.
 *
 * Rules:
 * - Prices/percentages: round to 3 decimals max, strip trailing zeros
 * - Dollar amounts (margin/notional/capital): whole dollars, no cents
 * - Database stores raw precision — format only on display
 */

/**
 * Format a price: up to 3 decimals, trailing zeros stripped.
 * 82.4200 -> "82.42", 0.16843 -> "0.168", 100.0 -> "100"
 */
export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "\u2014";
  return value.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Format a price with $ prefix: $82.42
 */
export function fmtDollarPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "\u2014";
  return `$${value.toFixed(3).replace(/\.?0+$/, "")}`;
}

/**
 * Format a dollar amount: whole dollars, no cents.
 * 10.00 -> "$10", 80.00 -> "$80"
 */
export function fmtDollar(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "\u2014";
  return `$${Math.round(value)}`;
}

/**
 * Format a percentage: up to 3 decimals, trailing zeros stripped.
 * Does NOT add % sign. 4.52 -> "4.52", -4.6 -> "-4.6"
 */
export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "\u2014";
  return value.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Format a signed percentage: +4.52, -4.6, 0. No % sign.
 */
export function fmtPctSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return "\u2014";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(3).replace(/\.?0+$/, "")}`;
}
