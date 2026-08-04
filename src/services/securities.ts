import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { securities, type Security } from "@/db/schema";
import { isValidTicker, normalizeTicker } from "@/lib/ticker";
import { isProviderError } from "@/providers/errors";
import {
  getFilingsProvider,
  getQuoteProvider,
  getSupplementalProfileProvider,
} from "@/providers/registry";
import type { CompanyProfile } from "@/providers/types";

export class UnknownTickerError extends Error {
  constructor(ticker: string) {
    super(
      `Could not resolve "${ticker}". Check the symbol — only SEC registrants and symbols known to the configured quote provider can be added.`,
    );
    this.name = "UnknownTickerError";
  }
}

export class InvalidTickerError extends Error {
  constructor(ticker: string) {
    super(`"${ticker}" is not a valid ticker symbol.`);
    this.name = "InvalidTickerError";
  }
}

/**
 * Build a company record from whatever sources are configured.
 *
 * EDGAR is authoritative for legal name and CIK and needs no API key, so it is
 * tried first — that is what lets the app resolve real company identities with
 * zero configuration. Finnhub, when enabled, fills in exchange and industry.
 */
async function resolveProfile(ticker: string): Promise<CompanyProfile | null> {
  let base: CompanyProfile | null = null;

  try {
    base = await getFilingsProvider().getProfile(ticker);
  } catch (err) {
    // A network or SEC outage must not block adding a company.
    if (!isProviderError(err)) throw err;
    console.warn(`edgar profile lookup failed for ${ticker}: ${err.message}`);
  }

  const supplemental = getSupplementalProfileProvider();
  if (supplemental) {
    try {
      const extra = await supplemental.getProfile(ticker);
      if (extra) {
        base = {
          ticker,
          name: base?.name ?? extra.name,
          cik: base?.cik ?? extra.cik,
          exchange: base?.exchange ?? extra.exchange,
          sector: base?.sector ?? extra.sector,
          industry: base?.industry ?? extra.industry,
        };
      }
    } catch (err) {
      if (!isProviderError(err)) throw err;
      console.warn(`profile lookup failed for ${ticker}: ${err.message}`);
    }
  }

  return base;
}

/** Confirms the symbol actually trades, so typos do not become rows. */
async function quoteExists(ticker: string): Promise<boolean> {
  try {
    await getQuoteProvider().getQuote(ticker);
    return true;
  } catch (err) {
    if (isProviderError(err) && err.code === "not_found") return false;
    // Any other failure is about us, not the symbol — do not reject on it.
    return true;
  }
}

export async function findOrCreateSecurity(input: string): Promise<Security> {
  const ticker = normalizeTicker(input);
  if (!isValidTicker(ticker)) throw new InvalidTickerError(input);

  const db = getDb();

  const existing = await db
    .select()
    .from(securities)
    .where(eq(securities.ticker, ticker))
    .limit(1);
  if (existing[0]) return existing[0];

  const profile = await resolveProfile(ticker);
  if (!profile && !(await quoteExists(ticker))) {
    throw new UnknownTickerError(ticker);
  }

  const [row] = await db
    .insert(securities)
    .values({
      ticker,
      name: profile?.name ?? ticker,
      exchange: profile?.exchange ?? null,
      cik: profile?.cik ?? null,
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
    })
    // Concurrent adds of the same ticker race on the unique index; converge
    // instead of failing, and let the second writer improve a sparse record.
    .onConflictDoUpdate({
      target: securities.ticker,
      set: {
        name: profile?.name ?? ticker,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) throw new Error(`failed to persist security ${ticker}`);
  return row;
}
