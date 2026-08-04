# Build Plan

## 1. What we're building

A personal web dashboard with four jobs:

1. **Watch** — a list of companies, their prices, and what's happening to them
2. **Understand** — every financial concept explained in place, using the numbers
   on screen rather than generic definitions
3. **Own** — manual portfolio and P&L tracking
4. **Notice** — alerts and a digest so you don't have to check constantly

Decisions locked: web dashboard, Next.js + TypeScript + Postgres, free data tiers
behind a provider abstraction so paid upgrades are a config change.

---

## 2. Architecture

Three loops that must stay separate:

```
  ┌──────────┐      ┌──────────┐      ┌──────────┐
  │  INGEST  │─────▶│  ENRICH  │─────▶│   READ   │
  └──────────┘      └──────────┘      └──────────┘
  cron polls        dedup, link       UI queries
  providers         to tickers,       only our DB
  → our DB          score, explain
```

### The one rule

**No third-party data API is ever called from the browser or during a page
render.** Cron writes to Postgres; the app reads Postgres. Everything else in
this document depends on that. Violating it means leaked API keys, rate-limit
exhaustion on page refresh, and a dashboard that breaks when a provider has a
bad day.

### Provider abstraction

Because we start free and may upgrade, providers sit behind interfaces and the
database never sees a provider-specific shape.

```ts
interface QuoteProvider {
  getQuote(ticker: string): Promise<Quote>;
  getDailyBars(ticker: string, from: Date, to: Date): Promise<Bar[]>;
}
interface NewsProvider {
  getCompanyNews(ticker: string, since: Date): Promise<RawArticle[]>;
}
interface FundamentalsProvider { /* ... */ }
interface FilingsProvider { /* ... */ }
```

Adapters: `FinnhubQuotes`, `FinnhubNews`, `EdgarFilings`, `AlphaVantageNews`,
`RssNews`. A registry resolves the active adapter per capability from env config.
Swapping Finnhub for Polygon later touches one file.

Each adapter owns its own rate limiting and backoff. Ingest jobs are idempotent
and resumable — they will get killed mid-run eventually.

---

## 3. Education as a primitive, not a feature

This is the part that's easy to get wrong. If explanations are built last, they
get retrofitted onto a UI that wasn't designed for them and coverage ends up
patchy. So the mechanism comes early and everything built afterward uses it.

### The mechanism

Three pieces:

**`concepts` table.** Every financial term is a row: slug, term, aliases,
one-liner, full MDX body, difficulty level, category. Authored content lives in
the repo as MDX and is seeded into the DB, so it's version-controlled and
reviewable.

**Prerequisite DAG.** You cannot explain P/E without EPS; EPS needs net income
and shares outstanding. `concept_edges` models this, which lets the UI say "this
builds on X, Y" and lets us order a learning path automatically.

**`<Term>` component.** Wraps any jargon in the UI. Hover or tap gives the
one-liner plus a link to the full explanation. Rendering a metric without a
concept link should fail lint — that's what keeps coverage honest.

### Static vs. AI explanation

Two different jobs, two different mechanisms:

| | Source | Why |
|---|---|---|
| **What is a P/E ratio?** | Static MDX, authored | Accuracy matters, never changes, zero latency, zero cost |
| **Why is *this* company's P/E 47 when its sector averages 20?** | LLM, on demand | Contextual, depends on live numbers, can't be pre-written |

Contextual explanations get cached in `explanations` keyed by
(concept, security, period) so we pay for each one once. Haiku is cheap enough
to run this generously.

### Progressive disclosure

A user-level setting (beginner / intermediate / advanced) controls how much
scaffolding renders. Without it, the UI becomes unreadable clutter for someone
who already knows what a dividend is. Beginner mode shows inline explainer cards;
advanced mode collapses everything to hover-only.

### The trick that makes coverage tractable

Fundamentals are stored narrow (EAV) with a `metric_key`, and `concept_metrics`
maps `metric_key → concept`. So every metric we ingest is *automatically*
explainable — no per-metric UI work, no manual wiring, and adding a new metric
to the ingest pipeline gets an explanation for free as soon as someone writes the
MDX. This is what turns "explain all financial concepts" from an endless manual
slog into a content-authoring backlog.

---

## 4. The genuinely hard problem: news relevance

Prices are a solved, boring endpoint. The UI is straightforward. The difficulty
is surfacing news *about the business* and suppressing everything else.

### Entity resolution

Naive company-name matching is a disaster — Apple, Target, Visa, Block, Match,
Gap, and Shell are all ordinary English words. Approach:

- Ticker match only with word boundaries or a `$` prefix
- Curated alias list per company: subsidiaries, brands, former names, CEO name
- Trust provider-supplied ticker tags above our own text matching
- Fall back to an LLM classifier only for borderline cases (cost control)

Record *which* method matched in `article_links.method` so we can measure
precision per method and tune.

### Deduplication

One press release becomes forty near-identical articles. Cascade:

1. Canonical URL (strip `utm_*`, fragments, tracking params)
2. Normalized-title hash
3. Near-duplicate via simhash over the first ~500 chars of body

Survivors cluster into a `story`; we pick a canonical article by source weight
and display "+39 similar."

### Materiality ranking

Rank by source weight × event type. An 8-K outranks a Seeking Alpha opinion piece
every time. Filings and primary IR releases sit at the top; aggregator listicles
sit at the bottom or get filtered out entirely.

---

## 5. Data model

```sql
-- Core
securities(id, ticker, exchange, name, cik, sector, industry,
           aliases text[], is_active)
watchlist_items(id, security_id, added_at, conviction, target_price, thesis)

-- Prices
price_bars(security_id, ts, open, high, low, close, volume,
           PRIMARY KEY (security_id, ts))
quotes_latest(security_id, price, change_pct, as_of, provider)

-- Fundamentals (narrow/EAV — new metrics need no migration)
fundamentals(security_id, period_end, period_type, metric_key,
             value, unit, source)

-- News
sources(id, name, kind, base_url, weight, enabled)
stories(id, canonical_article_id, first_seen_at, article_count)
articles(id, source_id, story_id, url_canonical, title, published_at,
         snippet, simhash)
article_links(article_id, security_id, relevance, method)   -- many-to-many

-- Filings & events
filings(id, security_id, cik, accession_no, form_type, filed_at,
        url, plain_summary)
events(id, security_id, kind, scheduled_at, actual_at, payload jsonb)

-- Education (first-class)
concepts(id, slug, term, aliases text[], one_liner, body_mdx, level, category)
concept_edges(concept_id, prerequisite_id)        -- DAG
concept_metrics(concept_id, metric_key)           -- auto-links metrics → concepts
explanations(id, concept_id, security_id, period, body, model, generated_at)
user_progress(user_id, concept_id, status, last_seen_at)

-- Portfolio
accounts(id, name, currency)
transactions(id, account_id, security_id, kind, trade_date,
             quantity, price, fees, notes)       -- buy|sell|dividend|split|transfer
positions_snapshot(account_id, security_id, as_of, quantity,
                   cost_basis, market_value)
corporate_actions(security_id, kind, ex_date, ratio, amount)

-- Alerts
alert_rules(id, security_id, kind, params jsonb, channel, enabled)
alert_events(id, rule_id, fired_at, payload jsonb, delivered_at)
```

Notes on specific choices:

- **`article_links` is many-to-many.** A supply-deal story legitimately concerns
  both companies and should appear on both pages.
- **`transactions` is the source of truth, `positions_snapshot` is derived.**
  Never store a mutable position row — recompute from the ledger. This is what
  saves us when a split or a backdated correction arrives.
- **`corporate_actions` is not optional.** Splits and dividends silently corrupt
  cost basis if ignored. This is the single most common bug in homegrown
  portfolio trackers.
- **Postgres full-text search** on `articles` covers search without adding
  Elasticsearch.

---

## 6. Portfolio specifics

Manual transaction entry first. Broker sync (Plaid / SnapTrade) is expensive and
carries real compliance weight — revisit only if manual entry becomes the thing
that stops you using the app.

Decisions to make when we get there:

- **Cost basis method** — FIFO vs. average cost. Affects realized P&L. Default
  FIFO, make it configurable per account.
- **Total return vs. price return** — dividends must be included or the numbers
  lie. Show both, explain the difference.
- **Multi-currency** — out of scope for v1 unless needed.

The educational payoff here is large: cost basis, realized vs. unrealized,
dividend yield, and total return are all abstract until you see them computed on
your own positions. Every portfolio number gets a `<Term>` wrapper.

---

## 7. Data sources

| Need | Provider | Notes |
|---|---|---|
| Quotes, company news | **Finnhub** | Best free tier (~60 req/min); per-ticker news endpoint |
| Filings | **SEC EDGAR** | Free, official, no key. `data.sec.gov/submissions/CIK*.json` + full-text search. Requires a declarative User-Agent |
| Ticker-tagged news + sentiment | **Alpha Vantage** `NEWS_SENTIMENT` | Good output, free tier ~25 calls/**day** — use sparingly |
| Long-tail news | **RSS** — company IR pages, Google News queries | Free, durable, no quota |
| Fundamentals | **Finnhub** / **FMP** free tiers | End-of-day only; fine for a watchlist |

Avoid NewsAPI.org (free tier is 24h-delayed, dev-use only). Treat `yfinance` as a
prototyping crutch only — unofficial scraping, breaks without warning.

Verify current limits at implementation time; free tiers move constantly.

**Licensing:** most free tiers prohibit redistribution. Personal use is fine; a
public multi-user version means paid plans and a different conversation.

---

## 8. Build order

Each phase leaves the app in a state you'd actually open.

### P0 — Foundation ✅ built
Next.js scaffold, Postgres + migrations, provider abstraction with Finnhub +
EDGAR adapters, cron wiring. Watchlist CRUD, last close and day change.
*Proves the ingest → DB → UI path end to end.*

Decisions taken during implementation, beyond what was planned:

- **A `mock` quote provider ships alongside the real ones.** The app runs with
  zero API keys, and its output is deterministic per ticker per day — random
  numbers that changed on every reload would look like a bug and would mask
  real caching and ingest faults.
- **EDGAR doubles as the zero-config identity source.** It needs no API key, so
  company name, CIK, exchange and SIC description resolve before any paid
  provider is configured. Finnhub, when enabled, only fills gaps.
- **History accumulates forward from quotes.** Free Finnhub plans no longer
  include `/stock/candle`; that 403 is mapped to a distinct `unsupported`
  error code and the ingest writes each quote as that day's bar instead of
  failing. History therefore builds from the day a ticker is added.
- **Mutations use Server Actions, not REST routes.** Only the cron endpoint
  needs to be callable by an external scheduler, and it is the only route with
  a shared-secret guard.
- **`ingest_runs` records every job execution.** Cron runs unattended; without
  it the sole symptom of a silently failing job is quietly stale prices.

### P1 — Explanation engine ✅ built
`concepts` schema, authoring pipeline, `<Term>` component, user-level setting,
prerequisite DAG. 77 concepts across nine categories.
*Built now so every later phase uses it by default.*

Decisions taken during implementation:

- **Content is authored as typed TypeScript modules, not MDX files.** The
  bodies are still plain markdown; wrapping them in modules makes the level
  and category unions compile-checked and avoids a frontmatter parser. The
  repo stays the source of truth and `concepts:seed` reconciles the database
  to it, including deleting concepts removed from the content.
- **Validation runs before anything is written.** Unique slugs, resolvable
  prerequisites, no cycles, one owner per metric, and no `/learn/` links to
  concepts that do not exist. The same checks run in the test suite, so a
  broken cross-reference fails CI rather than a page at runtime.
- **The concept index is request-cached via React `cache()`.** A page with
  fifty `<Term>`s issues one query. Explanation had to be cheap enough to use
  by default, otherwise it would get used sparingly and coverage would rot.
- **The tooltip is fixed-positioned and resets inherited typography.** It must
  escape the watchlist table's `overflow-x-auto` container, and it must not
  inherit the `uppercase`/`tracking-wide` of whatever it is anchored to.
- **Progressive disclosure is level-gated scaffolding, not level-gated
  access.** Every term is explainable at every level; what changes is whether
  the app volunteers an explanation unprompted.

### P2 — News ✅ built
Ingest from Finnhub + RSS, dedup cascade, entity resolution, per-company feed,
materiality ranking. *Where the app starts earning its keep.*

Decisions taken during implementation:

- **Fetching is per-security, so attribution does not depend on text.** Feeds
  are pulled one company at a time, which yields a `feed_query` link at 0.95
  without any matching. Text matching exists to find mentions of *other*
  watchlist companies, and since a wrong cross-link is worse than a missed
  one, those rules are deliberately conservative.
- **Single-word company names need corroboration.** A bare "Apple" scores 0.35
  and is dropped; "Apple Inc.", "Apple ($AAPL)", or a distinctive multi-word
  name scores 0.85. Tickers of one or two characters are ignored without a `$`
  prefix.
- **Story clustering is scoped to one company.** Corporate headlines are
  templated, so "Apple Reports Third Quarter Results" and "Microsoft Reports
  Third Quarter Results" clear any reasonable similarity bar. Candidates are
  restricted to articles already linked to the same security — two articles
  about different companies are never the same story.
- **Similarity requires simhash *and* token overlap, at a high threshold.**
  0.8 Jaccard, because "Apple Names New CFO" and "Apple Names New CEO" share
  0.6. Straight syndication is already caught by exact normalised-title match,
  so this stage only handles near-misses, and precision is worth more than
  recall: a duplicate is an annoyance, a swallowed story is a failure.
- **Materiality is multiplicative.** Source weight times event weight, so a
  trusted outlet does not launder a listicle and an aggregator's restatement
  ranks below the company's own release.
- **The feed stays chronological.** Ranking by score makes it impossible to
  see what is new; low-signal items are collapsed behind a disclosure instead.
- **Link provenance is exposed in the UI**, not just stored — the per-method
  counts and average confidence are what make the relevance rules tunable
  against evidence.

Not built here: the company page carries news only. Fundamentals, filings and
the earnings calendar join it in P3.

### P3 — Company detail ✅ built
Fundamentals ingest into the EAV table, metric → concept auto-linking, EDGAR
filings poller with form-type plain-English mapping, earnings calendar.

Decisions taken during implementation:

- **EDGAR XBRL is the fundamentals source.** Free, official, no API key, and
  it reports what the company actually filed — the same reasoning that made
  EDGAR the zero-config identity source in P0.
- **Only asserted facts are stored; everything else is derived on read.**
  Margins, market cap, P/E, free cash flow and the balance-sheet ratios are
  computed from stored facts plus the live price. A stored market cap is
  stale the moment it is written, and a stored margin can silently disagree
  with the revenue it came from after a restatement.
- **Period type is decided by elapsed days, not by the `fp` field.** A 10-K
  carries quarterly facts too, and nine-month cumulatives are discarded rather
  than filed under a period they are not.
- **Restatements overwrite.** The composite primary key means re-ingesting a
  period updates it, and the most recently filed value wins.
- **Each metric has an ordered list of candidate XBRL tags**, since companies
  spell revenue at least three ways — but tags are never mixed for one metric,
  because different tags can mean subtly different things.
- **Form codes are translated.** Every filing row leads with what the form
  actually is, and links to the concept where P1 explains it.
- **Time-dependent display values are resolved in the service layer.** Reading
  the clock during render is impure; "upcoming" and "days away" are settled
  once, at the data layer.

The P1 mechanism did its job here: adding the new metric keys to the registry
made `concepts:coverage` fail until `assets`, `liabilities` and
`shares_outstanding` were mapped to their concepts.

### P4 — Portfolio ✅ built
Transaction ledger, corporate-action handling, cost basis, realized and
unrealized P&L — every figure explained in place.

Decisions taken during implementation:

- **Exact decimal arithmetic, not floats.** `12.34 * 3` is
  `37.019999999999996` in binary floating point, and that residue compounds
  through every lot into a realised gain a tax authority may care about. All
  ledger maths runs on BigInt integers scaled by 10⁸, rounding half away from
  zero. Parsing goes via the string, never through `Number`.
- **No positions table at all.** The plan sketched one; it is not built. Every
  read replays the transaction log, so a backdated correction or a newly
  recorded split takes effect immediately and there is no second copy of the
  truth to drift.
- **Splits are applied at read time, never written back.** The ledger records
  what actually happened — 100 shares at $500 — and the engine presents the
  split-adjusted view. Rewriting history would destroy the audit trail and be
  unrepeatable if a ratio were later corrected.
- **Cost basis method is per account, and only moves value between buckets.**
  FIFO and average produce different realised gains from identical trades, and
  therefore different tax bills, but total return is identical either way.
  That invariant is pinned by a test — anything else would mean an accounting
  convention created money.
- **Sales are validated against holdings as at the trade date**, on entry
  rather than on render, so an impossible ledger is refused instead of
  producing unreadable figures later.
- **Full-precision currency in the portfolio.** Compact notation is right for
  a $383B revenue line and wrong for your own cost basis: "$35.0K" hides the
  $9.95 of fees and cannot be reconciled against a broker statement.
- **Securities held in the ledger cannot be deleted** (`ON DELETE RESTRICT`),
  because losing the other side of a transaction corrupts everything after it.

Not built here: a UI for entering corporate actions — splits are inserted
directly for now — and multi-currency conversion.

### P5 — AI layer
Story-cluster summaries, contextual explanations against live numbers,
plain-English filing summaries, materiality classification for borderline
articles. Cached and batched.

### P6 — Alerts and digest
Rules engine (price thresholds, new filings, keyword hits), morning email
digest, delivery log.

---

## 9. Risks and open questions

| Risk | Mitigation |
|---|---|
| Free-tier rate limits throttle ingest | Polling schedule sized to the tightest limit; provider abstraction makes upgrading cheap |
| News relevance precision is poor | Track precision per match method; tune rules before reaching for the LLM |
| Explanation content is a large authoring effort | Prioritize by what the UI actually renders; concept coverage lint shows the gap |
| LLM cost creeps | Cache by (concept, security, period); batch; Haiku for classification |
| Corporate actions corrupt cost basis | Ledger + recompute, never mutable positions |

Open questions, none blocking P0:

- Single-user or accounts? (Assume single-user; schema carries `user_id` so it's not a rewrite)
- Hosting: Vercel + Neon assumed. Confirm before P0.
- How far back should price history load on first add?
