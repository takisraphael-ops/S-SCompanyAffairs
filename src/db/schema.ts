import { sql } from "drizzle-orm";
import {
  boolean,
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

/** Ordered from least to most assumed knowledge; comparisons rely on that order. */
export const conceptLevel = pgEnum("concept_level", [
  "beginner",
  "intermediate",
  "advanced",
]);

export const progressStatus = pgEnum("progress_status", ["seen", "understood"]);

/** What kind of outlet a story came from. Drives the source weight. */
export const sourceKind = pgEnum("source_kind", [
  "ir", // company investor relations / official
  "wire", // Business Wire, PR Newswire, GlobeNewswire
  "regulator", // SEC and equivalents
  "outlet", // ordinary news organisations
  "aggregator", // syndicators and portals
  "mock",
]);

/**
 * What the article is about. Ordered loosely by how material it typically is;
 * see src/news/classify.ts for the weights.
 */
export const eventType = pgEnum("event_type", [
  "earnings",
  "guidance",
  "ma",
  "leadership",
  "capital_return",
  "legal",
  "product",
  "analyst",
  "opinion",
  "other",
]);

/**
 * How an article came to be linked to a security. Recorded so precision can
 * be measured per method and the rules tuned, rather than guessed at.
 */
export const linkMethod = pgEnum("link_method", [
  "provider_tag", // provider returned it for this ticker
  "feed_query", // we fetched a per-security feed
  "ticker", // $AAPL or AAPL on a word boundary in the text
  "name", // company name matched
  "alias", // curated alias matched
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

/* ------------------------------------------------------------------ *
 * News
 *
 * The difficulty here is not fetching — it is suppressing the churn. See
 * docs/PLAN.md §4. Three things carry that: story clustering so forty copies
 * of one press release appear once, per-method link provenance so relevance
 * rules can be measured rather than guessed at, and a materiality score so an
 * 8-K outranks a listicle.
 * ------------------------------------------------------------------ */

export const newsSources = pgTable("news_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Stable identifier used by adapters, e.g. "finnhub", "rss:google-news". */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: sourceKind("kind").notNull(),
  /**
   * 0–1 trust weight, multiplied into materiality. A company's own filing
   * outranks an aggregator restating it.
   */
  weight: numeric("weight", { precision: 4, scale: 3 }).notNull().default("0.5"),
  enabled: boolean("enabled").notNull().default(true),
});

/**
 * A cluster of articles reporting the same underlying event.
 *
 * The canonical article is chosen at read time by source weight rather than
 * stored here: a denormalised pointer would need updating whenever a
 * better-sourced copy arrives, and it would make stories and articles
 * mutually dependent for no real gain.
 */
export const stories = pgTable("stories", {
  id: uuid("id").defaultRandom().primaryKey(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Maintained by ingest so the feed can show "+N similar" without a subquery. */
  articleCount: integer("article_count").notNull().default(1),
});

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => newsSources.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    /** Tracking parameters stripped. The uniqueness key for "seen this already". */
    urlCanonical: text("url_canonical").notNull(),
    urlOriginal: text("url_original").notNull(),
    title: text("title").notNull(),
    /** Lowercased, publisher suffix and punctuation removed. Exact-match dedup. */
    titleNormalized: text("title_normalized").notNull(),
    publisher: text("publisher"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    snippet: text("snippet"),
    /** 64-bit simhash as 16 hex chars; near-duplicate prefilter. */
    simhash: text("simhash").notNull(),
    eventType: eventType("event_type").notNull().default("other"),
    /** 0–1: source weight times event weight. Drives ranking and collapsing. */
    materiality: numeric("materiality", { precision: 4, scale: 3 })
      .notNull()
      .default("0.5"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("articles_url_canonical_key").on(t.urlCanonical),
    index("articles_published_idx").on(t.publishedAt),
    index("articles_story_idx").on(t.storyId),
    index("articles_title_norm_idx").on(t.titleNormalized),
  ],
);

/**
 * Many-to-many by design: a supply agreement is genuinely news about both
 * parties and should appear on both watchlist entries.
 */
export const articleLinks = pgTable(
  "article_links",
  {
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    /** 0–1 confidence that the article is really about this company. */
    relevance: numeric("relevance", { precision: 4, scale: 3 }).notNull(),
    method: linkMethod("method").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.securityId] }),
    index("article_links_security_idx").on(t.securityId),
  ],
);

/* ------------------------------------------------------------------ *
 * Education
 *
 * First-class, not an afterthought (docs/PLAN.md §3). Content is authored
 * in src/content/concepts and seeded here, so the repo stays the source of
 * truth while the database serves the read path and the joins.
 * ------------------------------------------------------------------ */

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** URL segment: /learn/<slug>. Stable; renaming one breaks bookmarks. */
    slug: text("slug").notNull(),
    term: text("term").notNull(),
    /** Alternate phrasings, for search and for future prose auto-linking. */
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    /** Tooltip text. Must stand alone without the full article. */
    oneLiner: text("one_liner").notNull(),
    /** Markdown. Rendered server-side. */
    body: text("body").notNull(),
    level: conceptLevel("level").notNull().default("beginner"),
    category: text("category").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("concepts_slug_key").on(t.slug),
    index("concepts_category_idx").on(t.category),
  ],
);

/**
 * Prerequisite edges. `concept_id` requires `prerequisite_id`.
 *
 * This is a DAG, not a tree — P/E needs both EPS and share price. Cycles are
 * rejected at seed time; without that check the learning-path walk would not
 * terminate.
 */
export const conceptEdges = pgTable(
  "concept_edges",
  {
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    prerequisiteId: uuid("prerequisite_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.conceptId, t.prerequisiteId] }),
    index("concept_edges_prereq_idx").on(t.prerequisiteId),
    // Cheap guard against the degenerate one-node cycle.
    check("concept_edges_no_self", sql`${t.conceptId} <> ${t.prerequisiteId}`),
  ],
);

/**
 * Maps a displayed metric to the concept that explains it.
 *
 * This is the mechanism that makes "explain every number" tractable: any
 * metric rendered through <MetricLabel> is explainable without per-metric UI
 * work, and `npm run concepts:coverage` reports the ones still missing.
 *
 * `metric_key` is the primary key — a metric has exactly one explanation.
 */
export const conceptMetrics = pgTable("concept_metrics", {
  metricKey: text("metric_key").primaryKey(),
  conceptId: uuid("concept_id")
    .notNull()
    .references(() => concepts.id, { onDelete: "cascade" }),
});

/**
 * Per-user preferences. Single-user for now, but keyed by user_id so adding
 * accounts later is a migration rather than a rewrite.
 */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  level: conceptLevel("level").notNull().default("beginner"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userProgress = pgTable(
  "user_progress",
  {
    userId: text("user_id").notNull(),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    status: progressStatus("status").notNull().default("seen"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.conceptId] })],
);

export type Security = typeof securities.$inferSelect;
export type NewSecurity = typeof securities.$inferInsert;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type PriceBar = typeof priceBars.$inferSelect;
export type QuoteLatest = typeof quotesLatest.$inferSelect;
export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewsSource = typeof newsSources.$inferSelect;
export type Story = typeof stories.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type ArticleLink = typeof articleLinks.$inferSelect;
export type EventType = (typeof eventType.enumValues)[number];
export type LinkMethod = (typeof linkMethod.enumValues)[number];
export type SourceKind = (typeof sourceKind.enumValues)[number];
export type Concept = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;
export type ConceptLevel = (typeof conceptLevel.enumValues)[number];
export type UserSettings = typeof userSettings.$inferSelect;
export type UserProgress = typeof userProgress.$inferSelect;
