import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * P0 schema: securities, watchlist, prices, and ingest observability.
 *
 * Later phases add news, filings, concepts, and the portfolio ledger — see
 * docs/PLAN.md §5 for the full target model. Columns here are shaped to
 * accommodate those without rework (notably `securities.aliases`, which P2
 * entity resolution depends on).
 *
 * Money is `numeric`, never `double precision`. Binary floating point cannot
 * represent most decimal fractions exactly, and the error compounds through
 * cost-basis arithmetic in P4. drizzle returns `numeric` as string; parse at
 * the edge only for display.
 */

export const ingestStatus = pgEnum("ingest_status", [
  "running",
  "ok",
  "partial",
  "failed",
]);

export const securities = pgTable(
  "securities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Always stored uppercase; see normalizeTicker(). */
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    exchange: text("exchange"),
    /** SEC Central Index Key, zero-padded to 10 chars. Null until resolved. */
    cik: text("cik"),
    sector: text("sector"),
    industry: text("industry"),
    /**
     * Alternate names used for news entity resolution in P2: brands,
     * subsidiaries, former names. Empty in P0.
     */
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("securities_ticker_key").on(t.ticker),
    index("securities_cik_idx").on(t.cik),
    check("securities_ticker_upper", sql`${t.ticker} = upper(${t.ticker})`),
  ],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Free-text: why this company is interesting. Becomes the P4 thesis journal. */
    thesis: text("thesis"),
    targetPrice: numeric("target_price", { precision: 18, scale: 6 }),
  },
  (t) => [uniqueIndex("watchlist_items_security_key").on(t.securityId)],
);

/**
 * Daily OHLCV history. Composite PK makes re-ingesting a date idempotent via
 * ON CONFLICT DO UPDATE — providers restate recent bars and we want the fix,
 * not a duplicate row.
 */
export const priceBars = pgTable(
  "price_bars",
  {
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    /** Session date at UTC midnight. */
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 18, scale: 6 }),
    high: numeric("high", { precision: 18, scale: 6 }),
    low: numeric("low", { precision: 18, scale: 6 }),
    close: numeric("close", { precision: 18, scale: 6 }).notNull(),
    volume: numeric("volume", { precision: 20, scale: 0 }),
    provider: text("provider").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.securityId, t.ts] }),
    index("price_bars_ts_idx").on(t.ts),
  ],
);

/**
 * Denormalised latest quote, one row per security. Kept separate from
 * price_bars because it updates intraday and the dashboard reads it on every
 * render — we do not want that query planning over the whole history table.
 */
export const quotesLatest = pgTable("quotes_latest", {
  securityId: uuid("security_id")
    .primaryKey()
    .references(() => securities.id, { onDelete: "cascade" }),
  price: numeric("price", { precision: 18, scale: 6 }).notNull(),
  previousClose: numeric("previous_close", { precision: 18, scale: 6 }),
  change: numeric("change", { precision: 18, scale: 6 }),
  changePct: numeric("change_pct", { precision: 12, scale: 6 }),
  dayHigh: numeric("day_high", { precision: 18, scale: 6 }),
  dayLow: numeric("day_low", { precision: 18, scale: 6 }),
  /** When the provider says the quote was taken. */
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  /** When we wrote it. Divergence from asOf reveals a stalled ingest. */
  fetchedAt: timestamp("fetched_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  provider: text("provider").notNull(),
});

/**
 * One row per ingest job execution. Cron runs unattended; without this the
 * only symptom of a silently failing job is stale numbers on the dashboard.
 */
export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    job: text("job").notNull(),
    status: ingestStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    itemsOk: integer("items_ok").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("ingest_runs_job_started_idx").on(t.job, t.startedAt)],
);

export type Security = typeof securities.$inferSelect;
export type NewSecurity = typeof securities.$inferInsert;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type PriceBar = typeof priceBars.$inferSelect;
export type QuoteLatest = typeof quotesLatest.$inferSelect;
export type IngestRun = typeof ingestRuns.$inferSelect;
