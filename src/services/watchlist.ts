import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { quotesLatest, securities, watchlistItems } from "@/db/schema";
import { findOrCreateSecurity } from "./securities";

export interface WatchlistRow {
  watchlistItemId: string;
  securityId: string;
  ticker: string;
  name: string;
  exchange: string | null;
  cik: string | null;
  industry: string | null;
  addedAt: Date;
  price: string | null;
  previousClose: string | null;
  change: string | null;
  changePct: string | null;
  asOf: Date | null;
  fetchedAt: Date | null;
  provider: string | null;
}

/**
 * The dashboard's only query. Reads exclusively from our own tables — no
 * provider call happens on render (docs/PLAN.md §2).
 */
export async function listWatchlist(): Promise<WatchlistRow[]> {
  return getDb()
    .select({
      watchlistItemId: watchlistItems.id,
      securityId: securities.id,
      ticker: securities.ticker,
      name: securities.name,
      exchange: securities.exchange,
      cik: securities.cik,
      industry: securities.industry,
      addedAt: watchlistItems.addedAt,
      price: quotesLatest.price,
      previousClose: quotesLatest.previousClose,
      change: quotesLatest.change,
      changePct: quotesLatest.changePct,
      asOf: quotesLatest.asOf,
      fetchedAt: quotesLatest.fetchedAt,
      provider: quotesLatest.provider,
    })
    .from(watchlistItems)
    .innerJoin(securities, eq(watchlistItems.securityId, securities.id))
    // Left join: a security added seconds ago has no quote until ingest runs.
    .leftJoin(quotesLatest, eq(quotesLatest.securityId, securities.id))
    .orderBy(asc(securities.ticker));
}

/** Latest stored quote for one security, or null before the first ingest. */
export async function getQuoteFor(securityId: string) {
  const rows = await getDb()
    .select()
    .from(quotesLatest)
    .where(eq(quotesLatest.securityId, securityId))
    .limit(1);

  return rows[0] ?? null;
}

export async function addToWatchlist(ticker: string) {
  const security = await findOrCreateSecurity(ticker);

  await getDb()
    .insert(watchlistItems)
    .values({ securityId: security.id })
    // Adding a ticker already on the list is a no-op, not an error.
    .onConflictDoNothing({ target: watchlistItems.securityId });

  return security;
}

/**
 * Removes the watchlist entry but keeps the `securities` row and its price
 * history — re-adding later should not lose the series, and P4 portfolio
 * positions may still reference the security.
 */
export async function removeFromWatchlist(securityId: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(watchlistItems)
    .where(eq(watchlistItems.securityId, securityId))
    .returning({ id: watchlistItems.id });

  return deleted.length > 0;
}
