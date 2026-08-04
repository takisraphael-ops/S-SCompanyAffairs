/**
 * 64-bit simhash for near-duplicate detection.
 *
 * Unlike a cryptographic digest, similar inputs produce similar outputs, so
 * closeness is measurable as Hamming distance between two fingerprints. It is
 * used here as a cheap prefilter: candidates within a small distance are then
 * confirmed by token overlap (see src/news/dedup.ts).
 */

const BITS = 64n;
const MASK = (1n << BITS) - 1n;

/**
 * FNV-1a, widened to 64 bits.
 *
 * Not collision-resistant and not meant to be — simhash needs a fast hash
 * with well-distributed bits, not a secure one.
 */
function hash64(token: string): bigint {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < token.length; i++) {
    h ^= BigInt(token.charCodeAt(i));
    h = (h * prime) & MASK;
  }
  return h;
}

/**
 * Fingerprint a token list.
 *
 * Each bit position accumulates +weight when set in a token's hash and
 * -weight when clear; the sign of each column becomes the output bit. Tokens
 * shared by both documents therefore pull their fingerprints together.
 */
export function simhash(tokens: string[]): bigint {
  if (tokens.length === 0) return 0n;

  // Repeated tokens should count more than once, but not unboundedly.
  const weights = new Map<string, number>();
  for (const t of tokens) {
    weights.set(t, Math.min((weights.get(t) ?? 0) + 1, 4));
  }

  const columns = new Array<number>(64).fill(0);

  for (const [token, weight] of weights) {
    const h = hash64(token);
    for (let bit = 0; bit < 64; bit++) {
      const isSet = (h >> BigInt(bit)) & 1n;
      columns[bit] = (columns[bit] ?? 0) + (isSet === 1n ? weight : -weight);
    }
  }

  let out = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if ((columns[bit] ?? 0) > 0) out |= 1n << BigInt(bit);
  }
  return out;
}

/** Number of differing bits. 0 means identical fingerprints. */
export function hammingDistance(a: bigint, b: bigint): number {
  let diff = (a ^ b) & MASK;
  let count = 0;
  while (diff) {
    diff &= diff - 1n; // clears the lowest set bit
    count++;
  }
  return count;
}

/** Fixed-width hex, so fingerprints sort and compare as text in Postgres. */
export function toHex(value: bigint): string {
  return (value & MASK).toString(16).padStart(16, "0");
}

export function fromHex(hex: string): bigint {
  return BigInt(`0x${hex}`) & MASK;
}
