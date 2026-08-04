import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
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

/**
 * Reporting period a fact covers.
 *
 * Balance-sheet facts are instantaneous, but they are still filed as part of
 * an annual or quarterly report, so they are tagged with that period and
 * `period_end` carries the instant. `ttm` is reserved for trailing-twelve-month
 * figures assembled from four quarters.
 */
export const periodType = pgEnum("period_type", [
  "annual",
  "quarterly",
  "ttm",
]);

/**
 * How to decide which shares were sold when a position was built in pieces.
 *
 * The choice changes the realised gain from identical trades, so it is a
 * per-account setting rather than a global assumption.
 */
export const costBasisMethod = pgEnum("cost_basis_method", [
  "fifo",
  "average",
]);

export const transactionKind = pgEnum("transaction_kind", [
  "buy",
  "sell",
  "dividend",
  "transfer_in",
  "transfer_out",
]);

/**
 * Events that change the share count or the basis without being a trade.
 *
 * Modelled explicitly because ignoring them silently corrupts cost basis: a
 * 4-for-1 split leaves a position looking like a 75% loss, and every gain
 * computed afterwards is wrong by a factor of four.
 */
export const corporateActionKind = pgEnum("corporate_action_kind", [
  "split",
  "reverse_split",
]);

/** Scheduled or past company events. */
export const eventKind = pgEnum("event_kind", [
  "earnings",
  "dividend",
  "split",
  "shareholder_meeting",
]);

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
 * What a piece of generated text is. Each kind has its own prompt, its own
 * subject key and its own place in the UI — see src/ai/kinds.ts.
 */
export const generationKind = pgEnum("generation_kind", [
  "story_summary", // what a cluster of articles collectively says
  "filing_summary", // an SEC form, in plain English
  "metric_explanation", // why *this* company's number looks like this
  "article_classification", // the event type the keyword rules could not name
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
 * Portfolio
 *
 * The ledger is the source of truth and positions are derived from it on
 * every read. There is deliberately no positions table: a stored quantity or
 * cost basis is a second copy of the truth that drifts the moment a backdated
 * correction or a split arrives, and reconciling it is harder than
 * recomputing. A personal portfolio is a few hundred rows — replaying it is
 * free.
 * ------------------------------------------------------------------ */

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    /** ISO 4217. Multi-currency conversion is out of scope; this records intent. */
    currency: text("currency").notNull().default("USD"),
    costBasisMethod: costBasisMethod("cost_basis_method")
      .notNull()
      .default("fifo"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /*
     * Load-bearing. The account is created lazily on first use, and a single
     * page render calls that from several places at once — so without this,
     * two concurrent requests both see no account and both insert one. The
     * transactions then attach to one account while the portfolio reads the
     * other, and the holdings silently vanish.
     */
    uniqueIndex("accounts_name_key").on(t.name),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "restrict" }),
    kind: transactionKind("kind").notNull(),
    /** Date the trade happened, not when it was entered. */
    tradeDate: timestamp("trade_date", { withTimezone: true }).notNull(),
    /**
     * Shares, as actually transacted — never split-adjusted in place. History
     * records what happened; the ledger engine applies splits when it reads.
     */
    quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
    /** Price per share, or per-share amount for a dividend. */
    price: numeric("price", { precision: 18, scale: 8 }).notNull(),
    /** Commissions and charges. Part of the basis on a buy. */
    fees: numeric("fees", { precision: 18, scale: 8 }).notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Replay order: by trade date, then by entry order for same-day trades.
    index("transactions_account_date_idx").on(
      t.accountId,
      t.tradeDate,
      t.createdAt,
    ),
    index("transactions_security_idx").on(t.securityId),
    check("transactions_quantity_positive", sql`${t.quantity} > 0`),
    check("transactions_price_nonneg", sql`${t.price} >= 0`),
  ],
);

/**
 * Splits, applied to every transaction dated before the ex-date.
 *
 * `ratio` is new shares per old share: 4 for a 4-for-1 split, 0.1 for a
 * 1-for-10 reverse split.
 */
export const corporateActions = pgTable(
  "corporate_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    kind: corporateActionKind("kind").notNull(),
    exDate: timestamp("ex_date", { withTimezone: true }).notNull(),
    ratio: numeric("ratio", { precision: 18, scale: 8 }).notNull(),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("corporate_actions_unique").on(t.securityId, t.kind, t.exDate),
    index("corporate_actions_security_idx").on(t.securityId),
    check("corporate_actions_ratio_positive", sql`${t.ratio} > 0`),
  ],
);

/* ------------------------------------------------------------------ *
 * Fundamentals, filings and events
 * ------------------------------------------------------------------ */

/**
 * Reported financial facts, stored narrow.
 *
 * The EAV shape is what makes "explain every number" affordable
 * (docs/PLAN.md §3): `metric_key` joins to `concept_metrics`, so a metric
 * added to the ingest pipeline is explainable the moment its concept exists,
 * with no schema migration and no UI change.
 *
 * Only facts a provider actually asserted are stored. Anything derivable —
 * margins, market cap, P/E — is computed at read time from these plus the
 * live price, so a derived figure can never go stale against its inputs.
 */
export const fundamentals = pgTable(
  "fundamentals",
  {
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    /** Period close, or the instant for balance-sheet facts. */
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    periodType: periodType("period_type").notNull(),
    value: numeric("value", { precision: 30, scale: 6 }).notNull(),
    /** "USD", "USD/shares", "shares". */
    unit: text("unit").notNull().default("USD"),
    /** Provider that asserted it, plus the form where relevant. */
    source: text("source").notNull(),
    /** When the filing that asserted this was submitted; latest wins. */
    filedAt: timestamp("filed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Re-ingesting a period updates it rather than duplicating; restatements
    // therefore overwrite the figure they restate.
    primaryKey({
      columns: [t.securityId, t.metricKey, t.periodEnd, t.periodType],
    }),
    index("fundamentals_security_metric_idx").on(t.securityId, t.metricKey),
  ],
);

export const filings = pgTable(
  "filings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    cik: text("cik").notNull(),
    accessionNo: text("accession_no").notNull(),
    /** "10-K", "8-K", "4", … as SEC reports it. */
    formType: text("form_type").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    url: text("url").notNull(),
    /** Description SEC supplies for the primary document, when present. */
    description: text("description"),
    /*
     * No `plain_summary` column, despite docs/PLAN.md §5 naming one.
     *
     * The generated text lives in `ai_generations` and is read through one
     * left join. A copy here would have to carry the model that wrote it as
     * well — the UI labels generated text by model — and then the same fact
     * would exist in two places with nothing keeping them equal. That is the
     * argument this schema already makes about positions and the ledger, and
     * it applies here for the same reason.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // An accession number identifies a submission uniquely and for all time.
    uniqueIndex("filings_accession_key").on(t.accessionNo),
    index("filings_security_filed_idx").on(t.securityId, t.filedAt),
  ],
);

export const companyEvents = pgTable(
  "company_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    kind: eventKind("kind").notNull(),
    /** When it is expected, or happened. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** Free-form detail: EPS estimate, dividend amount, split ratio. */
    payload: jsonb("payload"),
    source: text("source").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One event of a kind per company per day; re-ingest updates the details.
    uniqueIndex("company_events_unique").on(
      t.securityId,
      t.kind,
      t.scheduledAt,
    ),
    index("company_events_scheduled_idx").on(t.scheduledAt),
  ],
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

/* ------------------------------------------------------------------ *
 * Generated text
 *
 * Everything an LLM writes lands here first, whatever it is about. One table
 * rather than one per kind, because the interesting columns are identical
 * (what it is about, what it was generated from, which model, what it cost)
 * and the differences are all in the prompt.
 *
 * The plan (docs/PLAN.md §5) called this `explanations`, keyed by concept,
 * security and period. That key only fits one of the four things P5
 * generates; `kind` + `subject_key` fits all of them and keeps the cost
 * accounting in one place.
 * ------------------------------------------------------------------ */

export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: generationKind("kind").notNull(),
    /**
     * What it is about, in a form the caller can reconstruct without a
     * lookup: a story id, a filing id, or "<security_id>:<metric_key>".
     */
    subjectKey: text("subject_key").notNull(),
    /**
     * Digest of everything the prompt was built from, including the prompt
     * template's own version.
     *
     * This is what makes the cache correct rather than merely cheap. Keyed on
     * the subject alone, a restated figure or a newly clustered article would
     * be described by text generated before it existed, and nothing would
     * ever notice. Keyed on the inputs, stale text regenerates itself.
     */
    inputHash: text("input_hash").notNull(),
    body: text("body").notNull(),
    /** The exact model string, so a change of model is visible in the data. */
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /**
     * The company this is about, when there is one. Nullable because a story
     * can concern several; it exists so deleting a security takes its
     * generated text with it.
     */
    securityId: uuid("security_id").references(() => securities.id, {
      onDelete: "cascade",
    }),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One current generation per subject. Regenerating replaces rather than
    // appends: this is a cache, and an unbounded history of superseded
    // paraphrases is not worth storing.
    uniqueIndex("ai_generations_subject_key").on(t.kind, t.subjectKey),
    index("ai_generations_security_idx").on(t.securityId),
  ],
);

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
export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type CorporateAction = typeof corporateActions.$inferSelect;
export type TransactionKind = (typeof transactionKind.enumValues)[number];
export type CostBasisMethod = (typeof costBasisMethod.enumValues)[number];
export type Fundamental = typeof fundamentals.$inferSelect;
export type NewFundamental = typeof fundamentals.$inferInsert;
export type Filing = typeof filings.$inferSelect;
export type CompanyEvent = typeof companyEvents.$inferSelect;
export type PeriodType = (typeof periodType.enumValues)[number];
export type EventKind = (typeof eventKind.enumValues)[number];
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
export type AiGeneration = typeof aiGenerations.$inferSelect;
export type NewAiGeneration = typeof aiGenerations.$inferInsert;
export type GenerationKind = (typeof generationKind.enumValues)[number];
