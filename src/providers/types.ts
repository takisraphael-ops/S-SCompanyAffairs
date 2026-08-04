/**
 * Normalised provider DTOs and capability interfaces.
 *
 * Nothing provider-specific may cross this boundary — the ingest layer and the
 * database only ever see these shapes. Swapping Finnhub for Polygon should
 * touch an adapter and the registry, nothing else.
 *
 * Note on numbers: these are JS numbers because that is what the upstream JSON
 * gives us; any precision loss already happened at the provider. They are
 * converted to `numeric` strings at the database boundary, where subsequent
 * arithmetic (cost basis in P4) must stay exact.
 */

export interface Quote {
  ticker: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  open: number | null;
  /** Provider's timestamp for the quote, not our fetch time. */
  asOf: Date;
}

export interface Bar {
  /** Session date, normalised to UTC midnight. */
  ts: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface CompanyProfile {
  ticker: string;
  name: string;
  exchange: string | null;
  cik: string | null;
  sector: string | null;
  industry: string | null;
}

export interface Filing {
  cik: string;
  accessionNo: string;
  formType: string;
  filedAt: Date;
  url: string;
  description: string | null;
}

/** A company to fetch news for. Feeds are keyed by name as well as ticker. */
export interface NewsTarget {
  securityId: string;
  ticker: string;
  name: string;
}

export interface RawArticle {
  title: string;
  url: string;
  publishedAt: Date;
  snippet?: string | null;
  /** Outlet that published it, when the feed names one. */
  publisher?: string | null;
  /** Tickers the provider itself tagged the article with, if any. */
  tickers?: string[];
  /** Which configured source this came from; see news_sources.key. */
  sourceKey: string;
  sourceName: string;
  sourceKind: SourceKindValue;
}

/**
 * Mirrors the `source_kind` enum. Declared here rather than imported so the
 * provider layer stays free of database concerns.
 */
export type SourceKindValue =
  | "ir"
  | "wire"
  | "regulator"
  | "outlet"
  | "aggregator"
  | "mock";

export interface NewsProvider {
  readonly name: string;
  /** Articles about `target` published since `since`. */
  getCompanyNews(target: NewsTarget, since: Date): Promise<RawArticle[]>;
}

export interface QuoteProvider {
  readonly name: string;
  getQuote(ticker: string): Promise<Quote>;
  /**
   * Daily OHLCV history. May throw a ProviderError with code `unsupported`
   * when the configured plan does not include historical candles — callers
   * are expected to degrade rather than fail. See src/ingest/quotes.ts.
   */
  getDailyBars(ticker: string, from: Date, to: Date): Promise<Bar[]>;
}

export interface ProfileProvider {
  readonly name: string;
  /** Null when the provider has no record of the ticker. */
  getProfile(ticker: string): Promise<CompanyProfile | null>;
}

export interface FilingsProvider {
  readonly name: string;
  /** Ticker to zero-padded 10-digit SEC Central Index Key. */
  resolveCik(ticker: string): Promise<string | null>;
  getRecentFilings(cik: string, limit?: number): Promise<Filing[]>;
}
