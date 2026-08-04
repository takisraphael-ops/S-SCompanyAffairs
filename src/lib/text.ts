/**
 * Text normalisation for headline comparison.
 *
 * Syndicated copy differs mostly in decoration: an appended publisher, a
 * different quote character, "Inc." present or absent. Stripping that reveals
 * how many "different" articles are the same wire story.
 */

/**
 * Publisher attribution appended to headlines by aggregators, e.g.
 * "Apple beats estimates - Reuters" or "… | Bloomberg".
 */
const PUBLISHER_SUFFIX = /\s+[-–—|]\s+[^-–—|]{2,40}$/;

const CORPORATE_SUFFIXES =
  /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|nv|sa|ag|holdings|group)\b\.?/gi;

/** Words carrying no discriminating signal in a headline. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "after", "over", "into", "amid",
  "says", "said", "will", "has", "have", "had", "s",
]);

/**
 * Canonical form of a headline, used for exact-match clustering.
 *
 * Deliberately lossy: it removes the publisher suffix, corporate suffixes,
 * punctuation and case. Two headlines that survive this identically are
 * almost always the same story.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    // Curly quotes and dashes vary between feeds for the same text.
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(PUBLISHER_SUFFIX, "")
    .toLowerCase()
    .replace(CORPORATE_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content-bearing tokens from already-normalised text. */
export function tokenize(normalized: string): string[] {
  return normalized
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Jaccard similarity over token sets: |A ∩ B| / |A ∪ B|.
 *
 * Used as the confirming test after the simhash prefilter. On short strings
 * simhash alone produces occasional false merges; requiring genuine token
 * overlap as well makes wrongly combining two distinct stories much less
 * likely, which matters more here than catching every last duplicate.
 */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);

  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
