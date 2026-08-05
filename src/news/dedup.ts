import { fromHex, hammingDistance } from "@/lib/simhash";
import { jaccard, tokenize } from "@/lib/text";

/**
 * Deciding whether an incoming article is a restatement of one we already have.
 *
 * A single press release routinely arrives as dozens of near-identical
 * articles. Collapsing them into one story is the difference between a usable
 * feed and a wall of the same headline.
 *
 * The cascade runs cheapest-first:
 *   1. identical normalised headline  — catches straight syndication
 *   2. simhash within a small Hamming distance, *confirmed* by token overlap
 *
 * Requiring both in step 2 is deliberate. On text as short as a headline,
 * simhash produces occasional false neighbours, and wrongly merging two
 * genuinely different stories hides one of them completely — a worse outcome
 * than showing a duplicate.
 *
 * The caller is responsible for one thing this function cannot check: the
 * candidate list must only contain articles already linked to the same
 * company. Corporate headlines are heavily templated, so "Apple Reports Third
 * Quarter Results" and "Microsoft Reports Third Quarter Results" overlap
 * enough to look like restatements of each other. Two articles about
 * different companies are never the same story, and scoping the candidates is
 * what enforces that. See src/ingest/news.ts.
 */

/** Max differing bits for two fingerprints to be considered neighbours. */
export const SIMHASH_MAX_DISTANCE = 8;

/**
 * Token overlap required to confirm a simhash neighbour.
 *
 * Set high deliberately, because headlines are short and the tokens that
 * differ are often the ones that matter most:
 *
 *   "Apple Names New CFO" vs "Apple Names New CEO"              → 0.60
 *   "Microsoft signs supply deal with $NVDA" vs
 *   "Nvidia signs supply deal with $AAPL"                        → 0.75
 *
 * Both are different stories, and both would merge at a looser threshold —
 * hiding one behind the other. Straight syndication is already caught by the
 * exact-title stage above, so this stage only needs to handle near-misses,
 * and it is worth trading recall for precision here: a duplicate in the feed
 * is a minor annoyance, a swallowed story is a failure.
 */
export const JACCARD_MIN = 0.8;

export interface DedupCandidate {
  id: string;
  storyId: string;
  titleNormalized: string;
  /** 16 hex chars, as stored. */
  simhash: string;
}

export interface DedupInput {
  titleNormalized: string;
  simhash: string;
}

export type DedupDecision =
  | { kind: "existing-story"; storyId: string; reason: "title" | "simhash"; matchedArticleId: string }
  | { kind: "new-story" };

export function decideStory(
  incoming: DedupInput,
  candidates: DedupCandidate[],
): DedupDecision {
  // 1. Exact normalised-headline match.
  const exact = candidates.find(
    (c) => c.titleNormalized === incoming.titleNormalized,
  );
  if (exact) {
    return {
      kind: "existing-story",
      storyId: exact.storyId,
      reason: "title",
      matchedArticleId: exact.id,
    };
  }

  // 2. Nearest fingerprint, confirmed by token overlap.
  const incomingHash = fromHex(incoming.simhash);
  const incomingTokens = tokenize(incoming.titleNormalized);

  let best: { candidate: DedupCandidate; distance: number } | null = null;

  for (const candidate of candidates) {
    const distance = hammingDistance(incomingHash, fromHex(candidate.simhash));
    if (distance > SIMHASH_MAX_DISTANCE) continue;

    const overlap = jaccard(incomingTokens, tokenize(candidate.titleNormalized));
    if (overlap < JACCARD_MIN) continue;

    if (!best || distance < best.distance) best = { candidate, distance };
  }

  if (best) {
    return {
      kind: "existing-story",
      storyId: best.candidate.storyId,
      reason: "simhash",
      matchedArticleId: best.candidate.id,
    };
  }

  return { kind: "new-story" };
}
