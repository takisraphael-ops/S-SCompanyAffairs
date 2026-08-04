import { eq, sql } from "drizzle-orm";
import { buildDigest } from "@/alerts/digest";
import { generate } from "@/ai/generate";
import { digestSummaryPrompt } from "@/ai/prompts";
import { getDb } from "@/db";
import { digests, ingestRuns } from "@/db/schema";
import { isProviderError } from "@/providers/errors";
import { getEmailNotifier, isEmailConfigured } from "@/providers/registry";

/**
 * The morning digest: assemble, summarise, store, send.
 *
 * Stored before it is sent, and stored even when sending fails. The record of
 * what a morning looked like is the durable part; delivery is a side effect
 * that can be retried or read on the page instead.
 *
 * Idempotent by date. Running it twice on the same morning rewrites the same
 * row rather than sending a second email — the unique index on `for_date`
 * makes that structural rather than a matter of remembering.
 */

export interface DigestResult {
  runId: string;
  job: string;
  status: "ok" | "partial" | "failed";
  forDate: string;
  itemCount: number;
  summarised: boolean;
  delivered: boolean;
  /** True when the digest for this date already existed and was refreshed. */
  rewritten: boolean;
  error?: string;
}

/** UTC midnight of the day a digest covers. One digest per calendar day. */
function digestDate(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function sendDigest(
  opts: { now?: Date; deliver?: boolean } = {},
): Promise<DigestResult> {
  const db = getDb();
  const job = "digest";
  const now = opts.now ?? new Date();
  const forDate = digestDate(now);

  const [run] = await db
    .insert(ingestRuns)
    .values({ job, status: "running" })
    .returning({ id: ingestRuns.id });
  if (!run) throw new Error("could not create ingest run");

  const finish = async (
    status: DigestResult["status"],
    error?: string,
  ): Promise<void> => {
    await db
      .update(ingestRuns)
      .set({
        status,
        finishedAt: new Date(),
        itemsOk: status === "failed" ? 0 : 1,
        itemsFailed: error ? 1 : 0,
        error: error?.slice(0, 4000) ?? null,
      })
      .where(eq(ingestRuns.id, run.id));
  };

  const existing = await db
    .select({ id: digests.id, deliveredAt: digests.deliveredAt })
    .from(digests)
    .where(eq(digests.forDate, forDate))
    .limit(1);

  const content = await buildDigest(now);

  /*
   * The opener is best-effort. A digest whose summary failed is still a
   * digest; refusing to send one because a model was unreachable would make
   * the AI layer a dependency of the alerting layer, which it is not.
   */
  let summary: string | null = null;
  let summaryModel: string | null = null;
  let summaryError: string | undefined;
  if (content.itemCount > 0) {
    try {
      const spec = digestSummaryPrompt({
        forDate,
        markdown: content.markdown,
        itemCount: content.itemCount,
      });
      const result = await generate(spec, {
        subjectKey: forDate.toISOString().slice(0, 10),
      });
      summary = result.body;
      summaryModel = result.model;
    } catch (err) {
      summaryError =
        isProviderError(err) || err instanceof Error
          ? err.message
          : String(err);
    }
  }

  const [row] = await db
    .insert(digests)
    .values({
      forDate,
      body: content.markdown,
      summary,
      summaryModel,
      itemCount: content.itemCount,
    })
    // Re-running the same morning refreshes rather than duplicates. The
    // delivery timestamp is deliberately preserved, so a second run does not
    // present an already-sent digest as unsent.
    .onConflictDoUpdate({
      target: digests.forDate,
      set: {
        body: sql`excluded."body"`,
        summary: sql`excluded."summary"`,
        summaryModel: sql`excluded."summary_model"`,
        itemCount: sql`excluded."item_count"`,
      },
    })
    .returning({ id: digests.id });

  if (!row) {
    await finish("failed", "could not write the digest");
    return {
      runId: run.id,
      job,
      status: "failed",
      forDate: forDate.toISOString().slice(0, 10),
      itemCount: content.itemCount,
      summarised: false,
      delivered: false,
      rewritten: existing.length > 0,
      error: "could not write the digest",
    };
  }

  // Already sent this morning: the row is refreshed, but nobody gets a
  // second email because a cron fired twice.
  const alreadyDelivered = existing[0]?.deliveredAt != null;
  const shouldDeliver =
    (opts.deliver ?? true) && !alreadyDelivered && isEmailConfigured();

  let delivered = alreadyDelivered;
  let deliveryError: string | undefined;

  if (shouldDeliver) {
    try {
      await getEmailNotifier().send({
        subject: `Company affairs — ${forDate.toISOString().slice(0, 10)}`,
        body: summary ? `${summary}\n\n${content.markdown}` : content.markdown,
        idempotencyKey: `digest:${forDate.toISOString().slice(0, 10)}`,
      });
      await db
        .update(digests)
        .set({ deliveredAt: new Date(), deliveryError: null })
        .where(eq(digests.id, row.id));
      delivered = true;
    } catch (err) {
      deliveryError =
        isProviderError(err) || err instanceof Error
          ? err.message
          : String(err);
      await db
        .update(digests)
        .set({ deliveryError: deliveryError.slice(0, 500) })
        .where(eq(digests.id, row.id));
    }
  }

  const problem = deliveryError ?? summaryError;
  const status: DigestResult["status"] = deliveryError ? "partial" : "ok";
  await finish(status, problem);

  return {
    runId: run.id,
    job,
    status,
    forDate: forDate.toISOString().slice(0, 10),
    itemCount: content.itemCount,
    summarised: summary !== null,
    delivered,
    rewritten: existing.length > 0,
    ...(problem ? { error: problem } : {}),
  };
}
