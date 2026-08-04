/**
 * Exact decimal arithmetic for the portfolio ledger.
 *
 * Binary floating point cannot represent most decimal fractions, so
 * `12.34 * 3` is `37.019999999999996` and `0.1 + 0.2` is not `0.3`. Those
 * errors are individually invisible and cumulatively fatal: cost basis is
 * built by repeatedly multiplying quantities by prices and subtracting the
 * results across many lots, and the residue ends up in a realised gain that
 * a tax authority may care about.
 *
 * Values are BigInt integers scaled by 10^8 — enough for fractional shares
 * and sub-cent prices. All arithmetic is exact; only division and
 * multiplication round, and they round half away from zero, which is the
 * convention people expect when money is involved.
 */

export const SCALE = 8;
export const ONE = 10n ** BigInt(SCALE);

/** A fixed-point decimal. Nominal typing keeps it from mixing with counts. */
export type Dec = bigint & { readonly __dec?: unique symbol };

export const ZERO = 0n as Dec;

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * Parse a decimal string exactly.
 *
 * Goes through the string rather than `Number`, because parsing to a float
 * first would bake in the very error this module exists to avoid.
 */
export function fromString(input: string | number): Dec {
  const text = typeof input === "number" ? String(input) : input.trim();
  if (!NUMERIC_RE.test(text)) {
    throw new Error(`not a decimal: ${JSON.stringify(input)}`);
  }

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  // Pad or truncate the fraction to exactly SCALE digits.
  const padded = fraction.padEnd(SCALE, "0").slice(0, SCALE);
  const magnitude = BigInt(whole) * ONE + BigInt(padded || "0");

  return (negative ? -magnitude : magnitude) as Dec;
}

/** Canonical decimal string; trailing fractional zeros removed. */
export function toString(value: Dec): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;

  const whole = magnitude / ONE;
  const fraction = (magnitude % ONE).toString().padStart(SCALE, "0");
  const trimmed = fraction.replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

/**
 * Fixed-scale string for a Postgres `numeric` column.
 *
 * Always emits SCALE decimal places so round-tripping is lossless.
 */
export function toDbString(value: Dec): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / ONE;
  const fraction = (magnitude % ONE).toString().padStart(SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** For display only. Never feed the result back into ledger arithmetic. */
export function toNumber(value: Dec): number {
  return Number(toString(value));
}

export function add(a: Dec, b: Dec): Dec {
  return (a + b) as Dec;
}

export function sub(a: Dec, b: Dec): Dec {
  return (a - b) as Dec;
}

export function neg(a: Dec): Dec {
  return -a as Dec;
}

export function abs(a: Dec): Dec {
  return (a < 0n ? -a : a) as Dec;
}

/**
 * Divide two scaled integers back down to one, rounding half away from zero.
 *
 * Shared by mul and div: both produce a value scaled by ONE too many (or too
 * few) and need the same rounding treatment.
 */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("decimal: division by zero");

  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const remainder = n % d;

  // Half away from zero: round up when the remainder is at least half.
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function mul(a: Dec, b: Dec): Dec {
  return divideRounded(a * b, ONE) as Dec;
}

export function div(a: Dec, b: Dec): Dec {
  return divideRounded(a * ONE, b) as Dec;
}

export function cmp(a: Dec, b: Dec): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isZero(a: Dec): boolean {
  return a === 0n;
}

export function isNegative(a: Dec): boolean {
  return a < 0n;
}

export function min(a: Dec, b: Dec): Dec {
  return a < b ? a : b;
}

export function max(a: Dec, b: Dec): Dec {
  return a > b ? a : b;
}

export function sum(values: Dec[]): Dec {
  return values.reduce((total, v) => (total + v) as Dec, ZERO);
}

/** Round to `places` decimal places, half away from zero. */
export function round(value: Dec, places: number): Dec {
  if (places >= SCALE) return value;
  const factor = 10n ** BigInt(SCALE - places);
  return (divideRounded(value, factor) * factor) as Dec;
}

/** Percentage change from `from` to `to`. Null when the base is zero. */
export function percentChange(from: Dec, to: Dec): Dec | null {
  if (isZero(from)) return null;
  return mul(div(sub(to, from), abs(from)), fromString("100"));
}
