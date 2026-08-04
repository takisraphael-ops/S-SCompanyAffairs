import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { ingestRuns, type IngestRun } from "@/db/schema";

/**
 * Most recent ingest run, for the dashboard's freshness indicator. Cron runs
 * unattended, so surfacing this is the difference between noticing a broken
 * job and quietly reading week-old prices.
 */
export async function getLastIngestRun(): Promise<IngestRun | null> {
  const rows = await getDb()
    .select()
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.startedAt))
    .limit(1);

  return rows[0] ?? null;
}
