import { inArray, sql } from "drizzle-orm";
import { generate, isStale, isSuperseded } from "@/ai/generate";
import { buildMetricPrompt } from "@/ai/subjects";
import { getDb } from "@/db";
import { aiGenerations, type GenerationKind } from "@/db/schema";
import { getUserLevel } from "@/services/concepts";

/**
 * Reading generated text, and the one place that generates it on demand.
 *
 * The split matters. Summaries are written by the batch job and only read
 * here, so a page render never waits on a model. Contextual explanations
 * cannot be written ahead of time — there are dozens of figures per company
 * and nobody looks at most of them — so they are generated when someone asks,
 * from a server action, and cached from then on.
 *
 * What is *not* here is a render-time generation path. That would put a
 * third-party call inside a page render, which is the one thing the whole
 * architecture is arranged to prevent (docs/PLAN.md §2).
 */

export interface GeneratedText {
  body: string;
  /** The model that wrote it. "mock" means placeholder text. */
  model: string;
  generatedAt: Date;
}

/** Whether the text came from a real model rather than the placeholder. */
export function isPlaceholder(text: { model: string }): boolean {
  return text.model === "mock";
}

export async function getGeneration(
  kind: GenerationKind,
  subjectKey: string,
): Promise<GeneratedText | null> {
  const rows = await getDb()
    .select({
      body: aiGenerations.body,
      model: aiGenerations.model,
      generatedAt: aiGenerations.generatedAt,
    })
    .from(aiGenerations)
    .where(
      sql`${aiGenerations.kind} = ${kind} and ${aiGenerations.subjectKey} = ${subjectKey}`,
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Summaries for a page of stories, in one query.
 *
 * The feed renders up to eighty rows; a lookup per row would be eighty round
 * trips for text that is optional.
 */
export async function getStorySummaries(
  storyIds: string[],
): Promise<Map<string, GeneratedText>> {
  if (storyIds.length === 0) return new Map();

  const rows = await getDb()
    .select({
      subjectKey: aiGenerations.subjectKey,
      body: aiGenerations.body,
      model: aiGenerations.model,
      generatedAt: aiGenerations.generatedAt,
    })
    .from(aiGenerations)
    .where(
      sql`${aiGenerations.kind} = 'story_summary' and ${inArray(aiGenerations.subjectKey, storyIds)}`,
    );

  return new Map(
    rows.map((r) => [
      r.subjectKey,
      { body: r.body, model: r.model, generatedAt: r.generatedAt },
    ]),
  );
}

export interface MetricExplanation extends GeneratedText {
  /**
   * True when the figures moved after this was written. Reported rather than
   * hidden: yesterday's explanation of a P/E is still worth reading, as long
   * as the reader is told the price has moved since.
   */
  stale: boolean;
  /**
   * True when this is placeholder text and a real model is now configured.
   * Distinct from stale, and handled differently: stale text is worth showing
   * with a caveat, placeholder text is worth replacing.
   */
  superseded: boolean;
}

/**
 * Explain one company's figure, generating it if we have not already.
 *
 * Called from a server action on a click, never from a render. The reader's
 * level is part of the prompt and therefore part of the cache key, so a
 * beginner and an advanced reader get different text and neither is served
 * the other's.
 */
export async function explainMetric(
  securityId: string,
  metricKey: string,
  opts: { force?: boolean } = {},
): Promise<MetricExplanation | null> {
  const level = await getUserLevel();
  const built = await buildMetricPrompt(securityId, metricKey, level);
  if (!built) return null;

  const result = await generate(built.spec, {
    subjectKey: built.subjectKey,
    securityId: built.securityId,
    force: opts.force,
  });

  return {
    body: result.body,
    model: result.model,
    generatedAt: new Date(),
    stale: false,
    superseded: false,
  };
}

/**
 * A previously generated explanation, without generating one.
 *
 * Used by the read path so a figure that has already been explained can show
 * it immediately, and so the staleness of the stored text is decided against
 * today's figures rather than against whatever they were when it was written.
 */
export async function readMetricExplanation(
  securityId: string,
  metricKey: string,
): Promise<MetricExplanation | null> {
  const level = await getUserLevel();
  const built = await buildMetricPrompt(securityId, metricKey, level);
  if (!built) return null;

  const rows = await getDb()
    .select()
    .from(aiGenerations)
    .where(
      sql`${aiGenerations.kind} = 'metric_explanation' and ${aiGenerations.subjectKey} = ${built.subjectKey}`,
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    body: row.body,
    model: row.model,
    generatedAt: row.generatedAt,
    stale: isStale(row, built.spec),
    superseded: isSuperseded(row),
  };
}
