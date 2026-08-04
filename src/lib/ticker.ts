/**
 * Tickers are stored uppercase and validated at every entry point; a database
 * CHECK constraint backs this up so no code path can insert a lowercase symbol.
 */

/** Letters, then optional digits/dot/hyphen for share classes (BRK.B, BRK-B). */
const TICKER_RE = /^[A-Z]{1,6}(?:[.-][A-Z0-9]{1,4})?$/;

export function normalizeTicker(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidTicker(input: string): boolean {
  return TICKER_RE.test(normalizeTicker(input));
}
