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
  /**
   * Whether a successful `getQuote` is evidence the symbol actually exists.
   *
   * False for any provider that synthesises data for whatever it is handed.
   * Such a provider cannot answer "no", so its "yes" carries no information
   * and must not be counted as confirmation that a symbol is real — see
   * `findOrCreateSecurity` in src/services/securities.ts.
   */
  readonly canVerifySymbols: boolean;
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

export interface FundamentalDatum {
  metricKey: string;
  periodEnd: Date;
  periodType: "annual" | "quarterly" | "ttm";
  value: number;
  unit: string;
  filedAt?: Date | null;
  /** Provenance, e.g. "edgar:10-K". */
  source: string;
}

export interface FundamentalsProvider {
  readonly name: string;
  /** Reported facts for a company. Empty when the provider has none. */
  getFundamentals(target: NewsTarget): Promise<FundamentalDatum[]>;
}

export interface CompanyEventDatum {
  kind: "earnings" | "dividend" | "split" | "shareholder_meeting";
  scheduledAt: Date;
  payload?: Record<string, unknown> | null;
  source: string;
}

export interface CalendarProvider {
  readonly name: string;
  /** Scheduled and recent events for a company. */
  getEvents(target: NewsTarget, from: Date, to: Date): Promise<CompanyEventDatum[]>;
}

export interface FilingsProvider {
  readonly name: string;
  /** Ticker to zero-padded 10-digit SEC Central Index Key. */
  resolveCik(ticker: string): Promise<string | null>;
  getRecentFilings(cik: string, limit?: number): Promise<Filing[]>;
}

/**
 * How much thinking a generation is worth paying for.
 *
 * Two tiers rather than a model name, because the caller knows how hard its
 * task is and should not also have to know which model is currently good at
 * it. Adapters map the tier to a model; see src/providers/registry.ts.
 */
export type LlmTier = "fast" | "careful";

export interface LlmRequest {
  /**
   * What is being generated, e.g. "story_summary". Carried so a failure names
   * the kind of work that failed, and so the mock adapter can shape a
   * plausible answer without parsing the prompt.
   */
  kind: string;
  /** One line naming the specific thing, e.g. "AAPL · Q3 results". */
  subject: string;
  /**
   * Instructions and constraints. Identical across every call of a given
   * kind, which is what makes it worth caching at the provider.
   */
  system: string;
  /** The part that varies: this company's figures, this story's headlines. */
  user: string;
  maxTokens: number;
  tier: LlmTier;
}

export interface LlmResult {
  text: string;
  /** The model that actually answered, recorded with the output. */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Text generation.
 *
 * Deliberately the narrowest interface that serves P5: one completion, no
 * tools, no streaming, no conversation. Everything generated here is a short
 * piece of prose about numbers we already hold, produced by a batch job or a
 * server action and then cached — none of which needs a chat loop.
 */
export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

export interface Notification {
  subject: string;
  /** Markdown. Adapters that need HTML render it themselves. */
  body: string;
  /**
   * Stable identifier for this message.
   *
   * Sends are retried on a timeout, and a timed-out send may well have
   * arrived. Adapters pass this to the provider's idempotency mechanism so a
   * retry cannot deliver a second copy.
   */
  idempotencyKey: string;
}

/**
 * Delivery of something the user asked to be told about.
 *
 * `send` resolving means the channel accepted the message, not that anyone
 * read it — that is as much as any of these can promise. Failure throws a
 * ProviderError, and the caller records it against the row rather than
 * retrying forever: an alert that could not be emailed is still in the inbox.
 */
export interface Notifier {
  readonly name: string;
  send(message: Notification): Promise<void>;
}
