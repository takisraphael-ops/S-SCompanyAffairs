import type { GenerationKind } from "@/db/schema";
import type { LlmTier } from "@/providers/types";

/**
 * The fixed properties of each kind of generation.
 *
 * Kept apart from the prompts themselves so the batch job can reason about
 * cost and tier without importing prompt text, and so a change of tier is one
 * line rather than a search through prose.
 */
export interface KindSpec {
  tier: LlmTier;
  maxTokens: number;
  /**
   * Bumped whenever the prompt for this kind changes in a way that would
   * change the answer.
   *
   * It is part of the hashed input, so bumping it regenerates every cached
   * entry of that kind on the next run. Without it, a rewritten prompt would
   * apply only to subjects that happened to be new, and the page would show a
   * mixture of two prompt generations with nothing to distinguish them.
   */
  version: number;
}

export const KINDS: Record<GenerationKind, KindSpec> = {
  /*
   * Restating what a set of headlines has in common needs no depth, and there
   * is one of these per story, so this is the highest-volume kind by far.
   */
  story_summary: { tier: "fast", maxTokens: 1500, version: 1 },

  /*
   * "What is a 10-Q and why did they file one" is textbook knowledge applied
   * to a form code. Cheap model, and the answer is short by construction.
   */
  filing_summary: { tier: "fast", maxTokens: 1500, version: 1 },

  /*
   * The one that justifies the phase. Reading a P/E of 47 against the
   * company's own margins and history — rather than reciting the formula —
   * is contextual reasoning, it is rare (one per figure a reader asks about),
   * and it is the output the app will be judged on. Generous ceiling because
   * a thinking model spends part of the budget before it writes anything.
   */
  metric_explanation: { tier: "careful", maxTokens: 8000, version: 1 },

  /*
   * A single word from a closed list. Cheap model, but with room to spare:
   * the ceiling has to cover a reasoning model's internal tokens if one is
   * configured here, or every answer would truncate.
   */
  article_classification: { tier: "fast", maxTokens: 2000, version: 1 },

  /*
   * Once a day, over a list the digest has already assembled: which two or
   * three of a dozen items actually matter. That is a judgement about
   * relative importance rather than a paraphrase, and it is the first thing
   * read each morning, so it goes to the capable model — at one call a day
   * it is the cheapest kind here regardless.
   */
  digest_summary: { tier: "careful", maxTokens: 8000, version: 1 },
};

export function specFor(kind: GenerationKind): KindSpec {
  return KINDS[kind];
}
