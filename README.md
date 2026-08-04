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

**P0 and P1 are built.** Watchlist with quote ingest, and the explanation
engine: 77 concepts, hover-to-explain on every metric, a browsable glossary,
and a prerequisite graph. See **[docs/PLAN.md](docs/PLAN.md)** for the
architecture and phase order.

| Phase | What | Status |
|---|---|---|
| P0 | Foundation: watchlist, quotes, ingest, cron | **done** |
| P1 | Explanation engine (concepts, `<Term>`, prerequisite DAG) | **done** |
| P2 | News ingest, dedup, entity resolution | next |
| P3 | Fundamentals, EDGAR filings, earnings calendar | planned |
| P4 | Portfolio ledger and P&L | planned |
| P5 | AI summaries and contextual explanations | planned |
| P6 | Alerts and morning digest | planned |

## Quick start

Requires Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env.local     # then edit DATABASE_URL
npm run db:migrate
npm run concepts:seed          # load the 77 explanations into the database
npm run dev                    # http://localhost:3000
```

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
| `npm run concepts:seed` | Reconcile the database with the authored concepts |
| `npm run concepts:coverage` | Fail if a displayed metric has no explanation |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
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
