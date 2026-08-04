import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  companyEvents,
  filings,
  fundamentals,
  ingestRuns,
  securities,
  watchlistItems,
} from "@/db/schema";
import { isProviderError } from "@/providers/errors";
import {
  getCalendarProviders,
  getFilingsProvider,
  getFundamentalsProviders,
} from "@/providers/registry";
import type { NewsTarget } from "@/providers/types";

export interface CompanyIngestResult {
  runId: string;
  job: string;
  status: "ok" | "partial" | "failed";
  fundamentals: number;
  filings: number;
  events: number;
  failed: number;
  errors: Array<{ target: string; message: string }>;
}

/** How far ahead and behind to pull calendar events. */
const CALENDAR_WINDOW_DAYS = 120;

/** Filings to keep per company. */
const FILING_LIMIT = 40;

async function ingestFundamentalsFor(target: NewsTarget): Promise<number> {
  const db = getDb();
  let written = 0;

  for (const provider of getFundamentalsProviders()) {
    const facts = await provider.getFundamentals(target);
    if (facts.length === 0) continue;

    // Chunked: a decade of quarterly facts across a dozen metrics is a few
    // hundred rows, and one statement per company keeps it a single round trip.
    const CHUNK = 400;
    for (let i = 0; i < facts.length; i += CHUNK) {
      const rows = facts.slice(i, i + CHUNK).map((f) => ({
        securityId: target.securityId,
        metricKey: f.metricKey,
        periodEnd: f.periodEnd,
        periodType: f.periodType,
        value: String(f.value),
        unit: f.unit,
        source: f.source,
        filedAt: f.filedAt ?? null,
      }));

      await db
        .insert(fundamentals)
        .values(rows)
        // A restatement overwrites the figure it restates; the composite key
        // is what makes re-ingesting a period an update rather than a duplicate.
        .onConflictDoUpdate({
          target: [
            fundamentals.securityId,
            fundamentals.metricKey,
            fundamentals.periodEnd,
            fundamentals.periodType,
          ],
          set: {
            value: sql`excluded."value"`,
            unit: sql`excluded."unit"`,
            source: sql`excluded."source"`,
            filedAt: sql`excluded."filed_at"`,
            updatedAt: new Date(),
          },
        });

      written += rows.length;
    }
  }

  return written;
}

async function ingestFilingsFor(
  target: NewsTarget,
  cik: string | null,
): Promise<number> {
  if (!cik) return 0;

  const provider = getFilingsProvider();
  const recent = await provider.getRecentFilings(cik, FILING_LIMIT);
  if (recent.length === 0) return 0;

  const rows = recent.map((f) => ({
    securityId: target.securityId,
    cik: f.cik,
    accessionNo: f.accessionNo,
    formType: f.formType,
    filedAt: f.filedAt,
    url: f.url,
    description: f.description,
  }));

  const inserted = await getDb()
    .insert(filings)
    .values(rows)
    // Accession numbers are permanent, so a filing we already have is simply
    // skipped rather than rewritten.
    .onConflictDoNothing({ target: filings.accessionNo })
    .returning({ id: filings.id });

  return inserted.length;
}

async function ingestEventsFor(target: NewsTarget): Promise<number> {
  const db = getDb();
  const from = new Date(Date.now() - CALENDAR_WINDOW_DAYS * 86_400_000);
  const to = new Date(Date.now() + CALENDAR_WINDOW_DAYS * 86_400_000);

  let written = 0;
  for (const provider of getCalendarProviders()) {
    const events = await provider.getEvents(target, from, to);
    if (events.length === 0) continue;

    await db
      .insert(companyEvents)
      .values(
        events.map((e) => ({
          securityId: target.securityId,
          kind: e.kind,
          scheduledAt: e.scheduledAt,
          payload: e.payload ?? null,
          source: e.source,
        })),
      )
      // Dates move; the details are refreshed rather than duplicated.
      .onConflictDoUpdate({
        target: [
          companyEvents.securityId,
          companyEvents.kind,
          companyEvents.scheduledAt,
        ],
        set: {
          payload: sql`excluded."payload"`,
          source: sql`excluded."source"`,
          updatedAt: new Date(),
        },
      });

    written += events.length;
  }

  return written;
}

/**
 * Pull fundamentals, filings and calendar events for the whole watchlist.
 *
 * Each company and each capability is isolated: EDGAR being unreachable must
 * not stop the calendar updating, and one company failing must not abort the
 * run. This is the slowest ingest job by a wide margin — companyfacts
 * documents are large — so it is scheduled daily rather than intraday.
 */
export async function ingestCompanyData(): Promise<CompanyIngestResult> {
  const db = getDb();
  const job = "company";

  const [run] = await db
    .insert(ingestRuns)
    .values({ job, status: "running" })
    .returning({ id: ingestRuns.id });
  if (!run) throw new Error("could not create ingest run");

  const watchlist = await db
    .select({
      securityId: securities.id,
      ticker: securities.ticker,
      name: securities.name,
      cik: securities.cik,
    })
    .from(watchlistItems)
    .innerJoin(securities, eq(watchlistItems.securityId, securities.id));

  const errors: CompanyIngestResult["errors"] = [];
  let fundamentalsWritten = 0;
  let filingsWritten = 0;
  let eventsWritten = 0;

  for (const row of watchlist) {
    const target: NewsTarget = {
      securityId: row.securityId,
      ticker: row.ticker,
      name: row.name,
    };

    for (const [label, task] of [
      ["fundamentals", () => ingestFundamentalsFor(target)],
      ["filings", () => ingestFilingsFor(target, row.cik)],
      ["events", () => ingestEventsFor(target)],
    ] as const) {
      try {
        const n = await task();
        if (label === "fundamentals") fundamentalsWritten += n;
        else if (label === "filings") filingsWritten += n;
        else eventsWritten += n;
      } catch (err) {
        errors.push({
          target: `${row.ticker}/${label}`,
          message:
            isProviderError(err) || err instanceof Error
              ? err.message
              : String(err),
        });
      }
    }
  }

  const wrote = fundamentalsWritten + filingsWritten + eventsWritten;
  const status: CompanyIngestResult["status"] =
    errors.length === 0
      ? "ok"
      : wrote === 0 && watchlist.length > 0
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
    fundamentals: fundamentalsWritten,
    filings: filingsWritten,
    events: eventsWritten,
    failed: errors.length,
    errors,
  };
}
