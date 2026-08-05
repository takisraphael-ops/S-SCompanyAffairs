import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  ingestRuns,
  priceBars,
  quotesLatest,
  securities,
  watchlistItems,
} from "@/db/schema";
import { isProviderError } from "@/providers/errors";
import { getQuoteProvider } from "@/providers/registry";
import type { Bar, Quote } from "@/providers/types";

export interface IngestResult {
  runId: string;
  job: string;
  status: "ok" | "partial" | "failed";
  ok: number;
  failed: number;
  errors: Array<{ ticker: string; message: string }>;
}

/** Postgres `numeric` binds as a string; `null` for anything non-finite. */
function num(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return String(v);
}

function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** `excluded.<col>` — the value the conflicting insert would have written. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

async function writeQuote(
  securityId: string,
  quote: Quote,
  provider: string,
): Promise<void> {
  const db = getDb();

  await db
    .insert(quotesLatest)
    .values({
      securityId,
      price: num(quote.price)!,
      previousClose: num(quote.previousClose),
      change: num(quote.change),
      changePct: num(quote.changePct),
      dayHigh: num(quote.dayHigh),
      dayLow: num(quote.dayLow),
      asOf: quote.asOf,
      fetchedAt: new Date(),
      provider,
    })
    .onConflictDoUpdate({
      target: quotesLatest.securityId,
      set: {
        price: num(quote.price)!,
        previousClose: num(quote.previousClose),
        change: num(quote.change),
        changePct: num(quote.changePct),
        dayHigh: num(quote.dayHigh),
        dayLow: num(quote.dayLow),
        asOf: quote.asOf,
        fetchedAt: new Date(),
        provider,
      },
    });

  // Also record the quote as today's bar. Free plans generally do not include
  // historical candles, so accumulating them forward from daily quotes is the
  // only way to build a series without paying. Re-running the job the same day
  // updates the row rather than duplicating it.
  const ts = utcMidnight(quote.asOf);
  await db
    .insert(priceBars)
    .values({
      securityId,
      ts,
      open: num(quote.open),
      high: num(quote.dayHigh),
      low: num(quote.dayLow),
      close: num(quote.price)!,
      volume: null,
      provider,
    })
    .onConflictDoUpdate({
      target: [priceBars.securityId, priceBars.ts],
      set: {
        open: num(quote.open),
        high: num(quote.dayHigh),
        low: num(quote.dayLow),
        close: num(quote.price)!,
        provider,
      },
    });
}

/**
 * Refresh a single security immediately.
 *
 * Called when a ticker is added so the row shows a price at once instead of
 * dashes until the next scheduled run.
 */
export async function refreshSecurity(
  securityId: string,
  ticker: string,
): Promise<void> {
  const provider = getQuoteProvider();
  const quote = await provider.getQuote(ticker);
  await writeQuote(securityId, quote, provider.name);
}

/**
 * Refresh quotes for every security on the watchlist.
 *
 * Runs sequentially on purpose: the provider rate limiter already caps
 * throughput, so concurrency would add failure modes without making the job
 * faster. A single ticker failing must not abort the run — errors are counted
 * and the run is marked `partial`.
 */
export async function ingestQuotes(): Promise<IngestResult> {
  const db = getDb();
  const provider = getQuoteProvider();
  const job = "quotes";

  const [run] = await db
    .insert(ingestRuns)
    .values({ job, status: "running" })
    .returning({ id: ingestRuns.id });

  if (!run) throw new Error("could not create ingest run");

  const targets = await db
    .select({ id: securities.id, ticker: securities.ticker })
    .from(watchlistItems)
    .innerJoin(securities, eq(watchlistItems.securityId, securities.id));

  const errors: IngestResult["errors"] = [];
  let ok = 0;

  for (const target of targets) {
    try {
      const quote = await provider.getQuote(target.ticker);
      await writeQuote(target.id, quote, provider.name);
      ok++;
    } catch (err) {
      const message =
        isProviderError(err) || err instanceof Error
          ? err.message
          : String(err);
      errors.push({ ticker: target.ticker, message });
    }
  }

  const status: IngestResult["status"] =
    errors.length === 0 ? "ok" : ok === 0 && targets.length > 0 ? "failed" : "partial";

  await db
    .update(ingestRuns)
    .set({
      status,
      finishedAt: new Date(),
      itemsOk: ok,
      itemsFailed: errors.length,
      error: errors.length
        ? errors.map((e) => `${e.ticker}: ${e.message}`).join("\n").slice(0, 4000)
        : null,
    })
    .where(eq(ingestRuns.id, run.id));

  return { runId: run.id, job, status, ok, failed: errors.length, errors };
}

/**
 * Best-effort history backfill, called when a security is first added.
 *
 * Returns the number of bars written; 0 when the provider has no historical
 * endpoint on the current plan. Never throws for provider reasons — a missing
 * backfill is a degraded feature, not a failed add.
 */
export async function backfillBars(
  securityId: string,
  ticker: string,
  days = 365,
): Promise<number> {
  const provider = getQuoteProvider();
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  let bars: Bar[];
  try {
    bars = await provider.getDailyBars(ticker, from, to);
  } catch (err) {
    if (isProviderError(err)) {
      console.warn(
        `backfill skipped for ${ticker} (${err.code}): ${err.message}`,
      );
      return 0;
    }
    throw err;
  }

  if (bars.length === 0) return 0;

  const db = getDb();
  const rows = bars.map((b) => ({
    securityId,
    ts: utcMidnight(b.ts),
    open: num(b.open),
    high: num(b.high),
    low: num(b.low),
    close: num(b.close)!,
    volume: b.volume != null ? String(Math.trunc(b.volume)) : null,
    provider: provider.name,
  }));

  // Chunked: a year of daily bars per ticker is fine in one statement, but a
  // multi-year backfill would otherwise build an unbounded parameter list.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(priceBars)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [priceBars.securityId, priceBars.ts],
        set: {
          open: sqlExcluded("open"),
          high: sqlExcluded("high"),
          low: sqlExcluded("low"),
          close: sqlExcluded("close"),
          volume: sqlExcluded("volume"),
        },
      });
  }

  return rows.length;
}
