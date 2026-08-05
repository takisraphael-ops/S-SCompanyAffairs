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

**All six phases are built.** Watchlist with quote ingest; the explanation
engine (79 concepts, hover-to-explain, prerequisite graph); news with story
clustering, entity resolution and materiality ranking; company detail with
fundamentals from SEC XBRL, translated filings and an earnings calendar; a
portfolio ledger with exact-decimal cost basis and split handling; an AI layer
that summarises story clusters, translates filings and explains a company's own
figures on request; and alerts with a morning digest. See
**[docs/PLAN.md](docs/PLAN.md)** for the architecture and phase order.

| Phase | What | Status |
|---|---|---|
| P0 | Foundation: watchlist, quotes, ingest, cron | **done** |
| P1 | Explanation engine (concepts, `<Term>`, prerequisite DAG) | **done** |
| P2 | News ingest, dedup, entity resolution, materiality | **done** |
| P3 | Fundamentals, EDGAR filings, earnings calendar | **done** |
| P4 | Portfolio ledger and P&L | **done** |
| P5 | AI summaries and contextual explanations | **done** |
| P6 | Alerts and morning digest | **done** |

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

### What happens when you mistype a ticker

EDGAR decides. It knows every SEC registrant, needs no key, and is therefore
the one source that can answer this on a fresh install — so a symbol it has
never heard of is refused rather than becoming a permanent row.

The mock quote provider deliberately gets no say. It prices any string it is
handed, so a price from it is not evidence of anything; letting it vouch for
symbols would mean every typo passed the check. Finnhub, which answers
`not_found` for symbols it does not know, does get a say, and covers the
foreign listings and funds that EDGAR does not.

If EDGAR cannot be reached at all, the symbol is accepted. An outage that
locks you out of adding companies is a dead end you cannot work around; one
unwanted row is a click to remove.

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

### Turning on the AI layer

The summaries and explanations run without a key too — as clearly-labelled
placeholder text, so you can see where they appear and what they replace. For
real ones, in `.env.local`:

```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key
```

then `npm run ingest:ai`. Placeholder text is treated as superseded once a key
is configured, so that one run replaces all of it — you do not have to clear
anything.

Two models are used: `claude-haiku-4-5` for the mechanical, high-volume work
(story summaries, filing translations, classification) and `claude-opus-5` for
explaining a company's figures in context. Override either with
`ANTHROPIC_FAST_MODEL` and `ANTHROPIC_MODEL`. `AI_MAX_GENERATIONS_PER_RUN`
(default 25) bounds what one run can spend; each run reports its token usage.

### Getting alerts by email

Alerts work with no configuration — a rule delivered to `inbox` is written to
the database and shown on `/alerts`. For email, get a key at
[resend.com](https://resend.com) (3,000 messages a month free) and set:

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=your_key
EMAIL_FROM=alerts@your-verified-domain.com
EMAIL_TO=you@example.com
```

Without it, `EMAIL_PROVIDER=console` prints what would have been sent to the
job log rather than dropping it silently.

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
| `npm run ingest:ai` | Write the summaries that are missing or stale; prints tokens spent |
| `npm run alerts` | Evaluate every enabled alert rule once |
| `npm run digest` | Build this morning's digest (`-- --no-send` to skip email) |
| `npm run concepts:seed` | Reconcile the database with the authored concepts |
| `npm run concepts:coverage` | Fail if a displayed metric has no explanation |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run setup` | Migrate and seed concepts in one step |
| `npm run lint` / `npm run typecheck` | Static checks |

CI runs all of these on every pull request (`.github/workflows/ci.yml`), in two
jobs. The static half — typecheck, lint, tests, coverage, build — runs with no
database and no configuration, which is the property that keeps a clean
checkout runnable. The other half brings up Postgres 16, applies every
migration from empty, and runs the smoke test against it.

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
  providers/     adapters (finnhub, edgar, anthropic, resend, mock) behind capability interfaces
  ingest/        scheduled jobs that write to the database
  ai/            prompts, generation cache, subject builders
  alerts/        rule definitions, evaluation, digest assembly
  news/          entity resolution, clustering, materiality
  services/      database reads and writes used by the UI
  content/       authored concept explanations + validation
  db/            drizzle schema and migrations
  app/           routes, server actions, cron endpoints
```

## How the portfolio works

The transaction log is the only stored truth. Positions, cost basis, realised
and unrealised gains are **recomputed from it on every page load** — there is
no positions table. A backdated correction or a newly recorded split therefore
takes effect immediately, and there is no second copy of the truth to drift.

**Splits are applied when the ledger is read, never written back.** The log
keeps what actually happened (100 shares at $500); the engine presents the
adjusted view (400 at $125). Same total cost — a split transfers no value —
and the audit trail survives.

**All ledger arithmetic is exact.** `12.34 * 3` is `37.019999999999996` in
binary floating point, and that residue compounds through every lot into a
realised gain that matters at tax time. Values are BigInt integers scaled by
10⁸, rounding half away from zero.

FIFO and average cost are both supported per account. They produce different
realised gains from identical trades — and therefore different tax bills — but
total return is identical either way, which is pinned by a test.

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

## What the AI layer does, and what it will not do

Authored content answers *what a P/E ratio is* — accurately, instantly, at no
cost, and identically for every company. It cannot answer *why this company's
is 47*, because that depends on numbers that move. That gap is the whole job.

**Every prompt carries the stored figures and forbids introducing others.**
The app's central claim is that a number and the words beside it cannot
disagree, and that fails the moment a model supplies a figure of its own. The
prompts also refuse investment advice outright: no cheap or expensive, no
prediction, no recommendation. Those two constraints are asserted by a test,
so a rewrite that drops them fails rather than ships.

**Nothing is generated during a page render.** Summaries are written by
`npm run ingest:ai` and read back out of Postgres, like every other ingest.
Contextual explanations are triggered by pressing **Why?** — a click, not a
render — because a company page carries thirty figures and generating all of
them on every visit would cost money to answer questions nobody asked.

**Everything generated is cached against a digest of the prompt that produced
it.** Not against the subject: keyed that way, a restated figure would be
described by text written before it existed and nothing would notice. Keyed on
the prompt, stale text regenerates itself, and rewriting a prompt regenerates
every answer it produced instead of leaving two generations side by side.

**Generated text is labelled by the model that wrote it**, and placeholder
text is labelled differently. You should never have to wonder which words came
from a filing and which from a model.

Three things it deliberately does not do. It does not read the filings — a
10-K would have to be fetched and chunked, which is a phase of its own — so
filing notes explain what a form is *for*, and say so. It does not replace the
news classifier; the keyword rules stay the first pass and the model only sees
what they could not name, one word from a closed list, rejected rather than
coerced if it answers anything else. And it does not write to the ledger:
nothing a model produces changes a number.

## How the alerts avoid becoming noise

An alerting feature fails in one specific way: it tells you the same thing
repeatedly until you turn it off. "AAPL above $200" is true on every run once
it is true at all, and a job that fires on the *condition* rather than on the
*change into it* sends a notification every fifteen minutes for as long as the
price stays there. Three mechanisms sit against that.

**Rules are edge-triggered.** A rule fires when it enters its condition and
re-arms only when the condition stops holding. The armed bit is stored per rule
*and* per company, because a watchlist-wide rule has to be able to fire for
Apple while it is still waiting on Microsoft.

**Every firing carries a dedupe key**, and there is a unique index on it. For
an event rule the key is the thing that triggered it — a filing can fire a rule
once and never again. For a threshold it is the level and the day, so a price
that crosses $200, dips and crosses again before the close is one alert rather
than two. Day *moves* are the exception: the direction is in the key, so a 6%
fall and a 6% recovery are correctly two things that happened.

The first two are logic and can be wrong. The index cannot, which is why it is
there as well.

**A rule watches forward.** It fires only for what arrives after you write it,
so creating a broad rule against a month of stored news does not produce sixty
notifications at once. `ALERT_LOOKBACK_DAYS` bounds the opposite case, where the
job has not run for a fortnight.

The morning digest applies the same judgement one level up: it lists material
forms only, collapses stories the way the feed does, and drops anything an
alert already reported — the same 8-K arriving as both "your rule fired" and
"a filing appeared" is one event.

## Scheduling

`vercel.json` runs six jobs: quotes every 30 minutes during US market hours on
weekdays, news every two hours, the AI pass 45 minutes after it, alerts every
15 minutes while the market is open, company data daily, and the digest each
weekday morning. Every route requires `Authorization: Bearer $CRON_SECRET`;
`CRON_SECRET` is mandatory in production, or the endpoint would let anyone burn
your provider quota — which now includes your model spend and your email
allowance.

Vercel's Hobby plan limits cron to one run per day. For intraday refresh, use
the Pro plan or drive `npm run ingest` from any external scheduler.

## Not investment advice

This is a personal research and learning tool. Nothing it produces —
including AI-generated summaries and explanations — is financial advice.
Market data is delayed and may be wrong.
