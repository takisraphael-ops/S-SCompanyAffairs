# S&S Company Affairs

A personal stock watchlist that explains itself.

Track companies you're interested in, follow what's actually happening to those
businesses (filings, earnings, material news — not price-move noise), record what
you own, and have every financial concept explained in place using your own
numbers.

## Why this exists

Every stock tracker assumes you already know what a P/E ratio is, what an 8-K
means, or why unrealized gain differs from realized gain. This one doesn't. Any
number it shows, it can explain — and it explains it in the context of the
company you're currently looking at, not as a generic dictionary entry.

## Status

**P0 through P3 are built.** Watchlist with quote ingest; the explanation
engine (77 concepts, hover-to-explain, prerequisite graph); news with story
clustering, entity resolution and materiality ranking; and company detail with
fundamentals from SEC XBRL, translated filings and an earnings calendar. See
**[docs/PLAN.md](docs/PLAN.md)** for the architecture and phase order.

| Phase | What | Status |
|---|---|---|
| P0 | Foundation: watchlist, quotes, ingest, cron | **done** |
| P1 | Explanation engine (concepts, `<Term>`, prerequisite DAG) | **done** |
| P2 | News ingest, dedup, entity resolution, materiality | **done** |
| P3 | Fundamentals, EDGAR filings, earnings calendar | **done** |
| P4 | Portfolio ledger and P&L | planned |
| P5 | AI summaries and contextual explanations | planned |
| P6 | Alerts and morning digest | planned |

## Quick start

Requires Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env.local     # then edit DATABASE_URL
npm run setup                  # migrate, then load the explanations
npm run dev                    # http://localhost:3000
```

`npm run setup` is migrate plus concept seed. Re-run it after changing
anything in `src/content/concepts` — the database is the read path, so
unseeded content means figures render without their explanations.

It runs with **no API keys**. `QUOTE_PROVIDER=mock` (the default) generates
deterministic fake prices, and company identity comes from SEC EDGAR, which
needs no key — only a `SEC_USER_AGENT` naming you.

### Using real market data

Get a free key at [finnhub.io](https://finnhub.io/register) (~60 requests per
minute), then in `.env.local`:

```
QUOTE_PROVIDER=finnhub
FINNHUB_API_KEY=your_key
```

Free Finnhub plans do not include historical candles. That is handled rather
than fatal: the app accumulates daily bars going forward from each quote, so
history builds itself from the day you add a ticker.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Unit tests (provider parsing, retry, rate limiting) |
| `npm run smoke` | Round-trip check against a real database — **writes to `DATABASE_URL`** |
| `npm run ingest` | Run the quote ingest once from the CLI |
| `npm run ingest:news` | Run the news ingest; prints the dedup and match-method breakdown |
| `npm run ingest:company` | Pull fundamentals, filings and calendar events |
| `npm run concepts:seed` | Reconcile the database with the authored concepts |
| `npm run concepts:coverage` | Fail if a displayed metric has no explanation |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run setup` | Migrate and seed concepts in one step |
| `npm run lint` / `npm run typecheck` | Static checks |

## Architecture in one paragraph

A scheduled job polls providers and writes into Postgres; the UI only ever
reads Postgres. **No third-party API is called from the browser or during a
page render** — that is the rule everything else depends on, and it is why the
app survives rate limits and provider outages. Providers sit behind capability
interfaces (`QuoteProvider`, `FilingsProvider`, …) resolved from environment
config, so moving from a free tier to a paid one is a config change rather than
a rewrite. See [docs/PLAN.md](docs/PLAN.md) §2.

```
src/
  providers/     adapters (finnhub, edgar, mock) behind capability interfaces
  ingest/        scheduled jobs that write to the database
  services/      database reads and writes used by the UI
  content/       authored concept explanations + validation
  db/            drizzle schema and migrations
  app/           routes, server actions, cron endpoint
```

## How the news filtering works

Prices are a solved endpoint. The hard part is showing what happened to a
*business* and suppressing everything else, and three mechanisms carry that.

**Attribution comes from the fetch, not the text.** Feeds are pulled one
company at a time, so an article is already attributed before any matching
happens. Text matching exists to catch mentions of *other* watchlist companies
— a supply agreement is genuinely news about both parties. Because a wrong
cross-link is worse than a missed one, those rules are conservative: a bare
"Apple" is not enough, but "Apple Inc.", "Apple ($AAPL)" or a distinctive
multi-word name is. Every link records *how* it matched, and `/news` shows the
per-method counts and average confidence so the rules can be tuned against
evidence.

**Story clustering** collapses the forty copies of one press release into one
entry with "+39 similar". The cascade is canonical URL, then exact normalised
headline, then simhash confirmed by token overlap. Candidates are scoped to
one company — corporate headlines are templated enough that "Apple Reports
Third Quarter Results" and "Microsoft Reports Third Quarter Results" would
otherwise merge, silently hiding one.

**Materiality** is source weight times event weight. An 8-K outranks a
listicle, and because it multiplies, a trusted outlet does not launder a
listicle. The feed stays chronological — reordering by score hides what is new
— and low-signal items collapse behind a disclosure instead.

## Where the numbers come from

Fundamentals are extracted from **SEC XBRL company facts** — free, official,
no API key. Only figures a company actually filed are stored. Everything
derivable — margins, market cap, P/E, free cash flow, the balance-sheet ratios
— is computed at read time from those facts plus the live price, so a derived
figure can never disagree with the numbers printed beside it.

Two details that are easy to get wrong: period type is decided by *elapsed
days* rather than the filing's own label, because a 10-K carries quarterly
facts too and nine-month cumulatives would otherwise be filed as quarters; and
each metric has an ordered list of candidate XBRL tags, because companies
spell revenue at least three different ways.

## How the explanations work

Content lives in `src/content/concepts` as typed modules with markdown bodies.
`npm run concepts:seed` validates it — unique slugs, resolvable prerequisites,
no cycles in the prerequisite graph, one concept per metric, no dead
`/learn/` links — and only then reconciles the database to match.

Two components consume it:

- `<Term slug="pe-ratio">P/E</Term>` explains a named concept.
- `<MetricLabel metricKey="change_pct">Change</MetricLabel>` explains whatever
  concept claims that metric.

The second is the one that scales. Because the mapping lives in
`concept_metrics` rather than in the UI, a metric added to the ingest pipeline
becomes explainable as soon as someone writes its concept — no component
changes. `npm run concepts:coverage` fails when a metric the UI can render has
no explanation, which is what stops coverage rotting as later phases add
fundamentals.

## Scheduling

`vercel.json` runs `/api/cron/quotes` every 30 minutes during US market hours on
weekdays. The route requires `Authorization: Bearer $CRON_SECRET`; `CRON_SECRET`
is mandatory in production, or the endpoint would let anyone burn your provider
quota.

Vercel's Hobby plan limits cron to one run per day. For intraday refresh, use
the Pro plan or drive `npm run ingest` from any external scheduler.

## Not investment advice

This is a personal research and learning tool. Nothing it produces —
including AI-generated summaries and explanations — is financial advice.
Market data is delayed and may be wrong.
