import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { generate } from "@/ai/generate";
import { CLASSIFIABLE_EVENT_TYPES, parseEventType } from "@/ai/prompts";
import {
  buildArticlePrompt,
  buildFilingPrompt,
  buildStoryPrompt,
} from "@/ai/subjects";
import { articles, ingestRuns } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { DEFAULT_SOURCE_WEIGHT, materialityScore } from "@/news/classify";
import { isProviderError } from "@/providers/errors";
import { isLlmConfigured } from "@/providers/registry";

/**
 * The batch half of the AI layer.
 *
 * Everything a reader would otherwise wait for is generated here, ahead of
 * time, and read back out of Postgres by the page — the same rule as every
 * other ingest job, and the reason the app stays fast and survives a provider
 * outage. The other half is on demand: a contextual explanation of one figure
 * is triggered by a click, because generating one for every figure on every
 * company would cost a great deal to answer questions nobody asked.
 *
 * Three properties keep the cost bounded and the failures survivable:
 *
 * - **Work is what is missing or stale**, decided by the cache. A second run
 *   over an unchanged database makes no calls at all.
 * - **Newest first, under a cap.** The backlog on a first run is every story
 *   and filing ever ingested. Capped and ordered, a run does the part someone
 *   is looking at and the next one continues.
 * - **Each item is isolated.** One refusal or one malformed answer costs that
 *   item, not the run.
 */

export interface AiIngestResult {
  runId: string;
  job: string;
  status: "ok" | "partial" | "failed";
  stories: number;
  filings: number;
  classified: number;
  /** Items already cached and skipped without a call. */
  skipped: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  errors: Array<{ target: string; message: string }>;
}

/**
 * A unit of work: something to generate, and what to do with the answer.
 *
 * Written as a queue rather than three loops so the per-run cap applies
 * across all kinds. Three independent caps would let a long filing backlog
 * starve story summaries indefinitely.
 */
interface Job {
  kind: "story" | "filing" | "classify";
  id: string;
  /** Ordering key; the queue is drained newest-first across every kind. */
  at: Date;
}

/**
 * Rows to redo because a key was configured after they were written.
 *
 * Empty while `LLM_PROVIDER=mock`, so a keyless install does not re-queue its
 * own placeholders on every run. See `isSuperseded` in src/ai/generate.ts for
 * why this is scoped to placeholders rather than to any change of model.
 */
function placeholderClause() {
  return isLlmConfigured() ? sql`or g.model = 'mock'` : sql``;
}

async function pendingStories(limit: number): Promise<Job[]> {
  /*
   * Stories whose summary is missing or whose cluster has changed.
   *
   * `last_seen_at` moving is the signal that an article was added to the
   * cluster after the summary was written — the summary is then describing
   * a subset of its own inputs. The prompt hash would catch it too, but
   * catching it here means not building a prompt to discover it.
   */
  const rows = await getDb().execute<{ id: string; at: Date }>(sql`
    select s.id, s.last_seen_at as at
    from stories s
    left join ai_generations g
      on g.kind = 'story_summary' and g.subject_key = s.id::text
    where g.id is null or g.generated_at < s.last_seen_at ${placeholderClause()}
    order by s.last_seen_at desc
    limit ${limit}
  `);
  return [...rows].map((r) => ({ kind: "story" as const, id: r.id, at: new Date(r.at) }));
}

async function pendingFilings(limit: number): Promise<Job[]> {
  /*
   * A filing's metadata never changes once submitted — an accession number
   * is permanent — so unlike a story there is no staleness to check. Either
   * it has a summary or it does not.
   */
  const rows = await getDb().execute<{ id: string; at: Date }>(sql`
    select f.id, f.filed_at as at
    from filings f
    left join ai_generations g
      on g.kind = 'filing_summary' and g.subject_key = f.id::text
    where g.id is null ${placeholderClause()}
    order by f.filed_at desc
    limit ${limit}
  `);
  return [...rows].map((r) => ({ kind: "filing" as const, id: r.id, at: new Date(r.at) }));
}

async function pendingClassifications(limit: number): Promise<Job[]> {
  /*
   * Only what the keyword rules could not name.
   *
   * "other" is the rules saying they do not know, and it is the one place a
   * model is worth paying for: everything they *did* match is already
   * classified for free and inspectably. Anything already attempted is
   * excluded whatever the outcome, so a headline the model also called
   * "other" is not re-bought on every run.
   */
  const rows = await getDb().execute<{ id: string; at: Date }>(sql`
    select a.id, a.published_at as at
    from articles a
    left join ai_generations g
      on g.kind = 'article_classification' and g.subject_key = a.id::text
    where a.event_type = 'other' and (g.id is null ${placeholderClause()})
    order by a.published_at desc
    limit ${limit}
  `);
  return [...rows].map((r) => ({ kind: "classify" as const, id: r.id, at: new Date(r.at) }));
}

/** What one item cost, whether or not it was already cached. */
interface Spend {
  generated: boolean;
  inputTokens: number;
  outputTokens: number;
}

const NOTHING: Spend = { generated: false, inputTokens: 0, outputTokens: 0 };

function spent(r: {
  generated: boolean;
  inputTokens: number;
  outputTokens: number;
}): Spend {
  return {
    generated: r.generated,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  };
}

async function runStory(id: string): Promise<Spend> {
  const built = await buildStoryPrompt(id);
  if (!built) return NOTHING;

  return spent(
    await generate(built.spec, {
      subjectKey: built.subjectKey,
      securityId: built.securityId,
    }),
  );
}

async function runFiling(id: string): Promise<Spend> {
  const built = await buildFilingPrompt(id);
  if (!built) return NOTHING;

  return spent(
    await generate(built.spec, {
      subjectKey: built.subjectKey,
      securityId: built.securityId,
    }),
  );
}

async function runClassification(id: string): Promise<Spend> {
  const built = await buildArticlePrompt(id);
  if (!built) return NOTHING;

  const result = await generate(built.spec, {
    subjectKey: built.subjectKey,
    securityId: built.securityId,
  });

  const eventType = parseEventType(result.body, CLASSIFIABLE_EVENT_TYPES);
  if (!eventType) {
    /*
     * Rejected rather than coerced: a stored answer outside the enum would be
     * a guess about what the model meant, and the article already says
     * "other", so leaving it alone loses nothing.
     *
     * The answer stays in the cache, which means this item is not retried on
     * the next run. That is deliberate — a model that answered with a
     * sentence will answer with a sentence again, and retrying it every
     * fifteen minutes would buy the same failure forever. The run reports it,
     * and the article keeps the classification the rules gave it.
     */
    throw new Error(
      `answer outside the event enum: ${JSON.stringify(result.body.slice(0, 80))}`,
    );
  }
  if (eventType === "other") return spent(result);

  /*
   * Materiality is recomputed rather than adjusted, from the same function
   * the rules use and the same source weight. The score is source weight
   * times event weight; reclassifying only the event type would leave the
   * product describing the old one, and the feed would rank an 8-K like the
   * "other" it used to be.
   */
  const db = getDb();
  const rows = await db.execute<{ weight: string; kind: string }>(sql`
    select s.weight, s.kind
    from articles a join news_sources s on s.id = a.source_id
    where a.id = ${id}
  `);
  const source = [...rows][0];
  const weight = source
    ? Number(source.weight)
    : DEFAULT_SOURCE_WEIGHT.aggregator;

  await db
    .update(articles)
    .set({
      eventType,
      materiality: String(materialityScore(eventType, weight)),
    })
    .where(eq(articles.id, id));

  return spent(result);
}

export async function ingestAi(
  opts: { limit?: number } = {},
): Promise<AiIngestResult> {
  const db = getDb();
  const job = "ai";
  const cap = opts.limit ?? getEnv().AI_MAX_GENERATIONS_PER_RUN;

  const [run] = await db
    .insert(ingestRuns)
    .values({ job, status: "running" })
    .returning({ id: ingestRuns.id });
  if (!run) throw new Error("could not create ingest run");

  // Each kind is asked for at most the whole budget, then the merged queue is
  // truncated to it. That way a run with only filings outstanding spends the
  // budget on filings, rather than reserving a third of it for work that does
  // not exist.
  const queue = (
    await Promise.all([
      pendingStories(cap),
      pendingFilings(cap),
      pendingClassifications(cap),
    ])
  )
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, cap);

  const counts = { stories: 0, filings: 0, classified: 0 };
  let skipped = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const errors: AiIngestResult["errors"] = [];

  for (const item of queue) {
    try {
      const result =
        item.kind === "story"
          ? await runStory(item.id)
          : item.kind === "filing"
            ? await runFiling(item.id)
            : await runClassification(item.id);

      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;

      if (!result.generated) {
        skipped++;
        continue;
      }
      if (item.kind === "story") counts.stories++;
      else if (item.kind === "filing") counts.filings++;
      else counts.classified++;
    } catch (err) {
      errors.push({
        target: `${item.kind}/${item.id.slice(0, 8)}`,
        message:
          isProviderError(err) || err instanceof Error
            ? err.message
            : String(err),
      });
    }
  }

  const wrote = counts.stories + counts.filings + counts.classified;

  const status: AiIngestResult["status"] =
    errors.length === 0
      ? "ok"
      : wrote === 0
        ? "failed"
        : "partial";

  await db
    .update(ingestRuns)
    .set({
      status,
      finishedAt: new Date(),
      itemsOk: wrote,
      itemsFailed: errors.length,
      error: errors.length
        ? errors.map((e) => `${e.target}: ${e.message}`).join("\n").slice(0, 4000)
        : null,
    })
    .where(eq(ingestRuns.id, run.id));

  return {
    runId: run.id,
    job,
    status,
    ...counts,
    skipped,
    failed: errors.length,
    inputTokens,
    outputTokens,
    errors,
  };
}
