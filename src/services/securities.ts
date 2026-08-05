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
 * The outcome of a profile lookup, distinguishing "no such company" from
 * "could not ask".
 *
 * Both produce a null profile, and conflating them is what decides whether an
 * SEC outage locks the user out or a typo becomes a permanent row. Only a
 * `conclusive` miss is evidence the symbol is not real.
 */
interface ProfileLookup {
  profile: CompanyProfile | null;
  conclusive: boolean;
}

/**
 * Build a company record from whatever sources are configured.
 *
 * EDGAR is authoritative for legal name and CIK and needs no API key, so it is
 * tried first — that is what lets the app resolve real company identities with
 * zero configuration. Finnhub, when enabled, fills in exchange and industry.
 */
async function resolveProfile(ticker: string): Promise<ProfileLookup> {
  let base: CompanyProfile | null = null;
  let conclusive = true;

  try {
    base = await getFilingsProvider().getProfile(ticker);
  } catch (err) {
    // A network or SEC outage must not block adding a company.
    if (!isProviderError(err)) throw err;
    conclusive = false;
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

  return { profile: base, conclusive };
}

/**
 * Confirms the symbol actually trades, so typos do not become rows.
 *
 * A provider that synthesises data for any input is not asked at all: it
 * would answer yes to everything, which is indistinguishable from having no
 * check. Silence from such a provider is the honest answer.
 */
async function quoteVouchesFor(ticker: string): Promise<boolean> {
  const provider = getQuoteProvider();
  if (!provider.canVerifySymbols) return false;

  try {
    await provider.getQuote(ticker);
    return true;
  } catch (err) {
    if (isProviderError(err) && err.code === "not_found") return false;
    // Any other failure is about us, not the symbol — do not reject on it.
    return true;
  }
}

/** What the configured sources were able to establish about a symbol. */
export interface SymbolEvidence {
  /** A source returned a company profile for it. */
  hasProfile: boolean;
  /** A quote provider capable of denying unknown symbols returned a price. */
  quoteVouches: boolean;
  /** The profile lookup completed, rather than failing to reach its source. */
  profileLookupConclusive: boolean;
}

/**
 * Whether the evidence says a symbol is not real.
 *
 * Separated from the I/O so the rule can be tested directly — it is the one
 * decision standing between a typo and a permanent watchlist row, and every
 * clause of it exists because of a way that goes wrong.
 */
export function isUnknownSymbol(ev: SymbolEvidence): boolean {
  if (ev.hasProfile || ev.quoteVouches) return false;
  // Nothing recognised it, but if nothing could be reached that is our
  // problem, not the user's.
  return ev.profileLookupConclusive;
}

/** Look up a security by ticker. Returns null when it is not tracked. */
export async function getSecurityByTicker(
  input: string,
): Promise<Security | null> {
  const ticker = normalizeTicker(input);
  if (!isValidTicker(ticker)) return null;

  const rows = await getDb()
    .select()
    .from(securities)
    .where(eq(securities.ticker, ticker))
    .limit(1);

  return rows[0] ?? null;
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

  /*
   * Accept when either source recognises the symbol, and reject only when one
   * of them actually looked and found nothing.
   *
   * The asymmetry is deliberate. Rejecting a real company because a source was
   * unreachable is a dead end the user cannot work around, so an inconclusive
   * lookup — an SEC outage, a timeout — falls through to accepting. Rejecting
   * requires positive evidence of absence from a source capable of giving it.
   */
  const { profile, conclusive } = await resolveProfile(ticker);
  const evidence: SymbolEvidence = {
    hasProfile: profile !== null,
    quoteVouches: profile === null && (await quoteVouchesFor(ticker)),
    profileLookupConclusive: conclusive,
  };
  if (isUnknownSymbol(evidence)) throw new UnknownTickerError(ticker);

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
