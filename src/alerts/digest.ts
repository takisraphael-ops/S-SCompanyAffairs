import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as D from "@/lib/decimal";
import { formatSignedCurrency } from "@/lib/derive";
import { isMaterialForm } from "@/lib/forms";
import { getPortfolio } from "@/services/portfolio";

/**
 * Assembling what happened since yesterday.
 *
 * Ordered by what the reader asked for rather than by time: the alerts they
 * wrote rules for, then filings, then material news, then what is coming, and
 * the portfolio last. A digest sorted chronologically buries an 8-K under
 * three price moves, which is the same mistake the news feed was designed to
 * avoid.
 *
 * Everything here is read from Postgres. Nothing is fetched and nothing is
 * generated — the model, when configured, writes only the opening lines, and
 * it writes them from this text rather than from the database.
 *
 * The composition is split from the reading (`composeDigest` below) so the
 * decisions worth arguing about — what is suppressed, what order, what an
 * empty morning says — can be tested without a database.
 */

export interface DigestSection {
  heading: string;
  lines: string[];
}

export interface DigestContent {
  forDate: Date;
  sections: DigestSection[];
  itemCount: number;
  markdown: string;
}

/** How far back a digest looks. A day, plus enough slack for a missed run. */
const WINDOW_HOURS = 26;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Index signature required by drizzle's `execute` row generic. */
interface Row extends Record<string, unknown> {
  ticker: string;
  title: string;
  detail: string | null;
  url: string | null;
}

async function recentFilings(since: Date): Promise<Row[]> {
  const rows = await getDb().execute<Row>(sql`
    select s.ticker, f.form_type as title, g.body as detail, f.url
    from filings f
    join securities s on s.id = f.security_id
    join watchlist_items w on w.security_id = s.id
    left join ai_generations g
      on g.kind = 'filing_summary' and g.subject_key = f.id::text
    where f.created_at >= ${since.toISOString()}::timestamptz
    order by f.filed_at desc
    limit 40
  `);

  /*
   * Material forms only, decided by the same function the filings list uses.
   *
   * Three companies file a dozen insider Form 4s in a quiet week. Listing
   * them puts the 8-K that actually matters eleventh, which is the failure
   * the rest of this app spends most of its effort avoiding — a digest is
   * the last place to reintroduce it. Filtered here rather than in SQL so
   * there is one definition of "material" rather than two.
   */
  return [...rows].filter((r) => isMaterialForm(r.title)).slice(0, 15);
}

async function materialNews(since: Date): Promise<Row[]> {
  /*
   * One row per story, not per article — the same collapsing the feed does.
   * A digest that lists forty copies of one press release is worse than no
   * digest, and the clustering that fixes that already happened at ingest.
   */
  const rows = await getDb().execute<Row>(sql`
    with best as (
      select distinct on (a.story_id)
        a.story_id, a.title, a.url_original as url, a.snippet,
        a.materiality, s.ticker, src.weight
      from articles a
      join news_sources src on src.id = a.source_id
      join article_links l on l.article_id = a.id and l.relevance >= 0.5
      join securities s on s.id = l.security_id
      join watchlist_items w on w.security_id = s.id
      where a.created_at >= ${since.toISOString()}::timestamptz and a.materiality >= 0.6
      order by a.story_id, src.weight desc, a.published_at asc
    )
    select ticker, title, snippet as detail, url
    from best
    order by materiality desc, ticker
    limit 15
  `);
  return [...rows];
}

async function firedAlerts(since: Date): Promise<Row[]> {
  const rows = await getDb().execute<Row>(sql`
    select coalesce(s.ticker, '—') as ticker, e.title, e.body as detail, e.url
    from alert_events e
    left join securities s on s.id = e.security_id
    where e.fired_at >= ${since.toISOString()}::timestamptz
    order by e.fired_at desc
    limit 20
  `);
  return [...rows];
}

async function upcomingEvents(now: Date): Promise<Row[]> {
  const horizon = new Date(now.getTime() + 7 * 86_400_000);
  const rows = await getDb().execute<Row>(sql`
    select s.ticker, e.kind as title,
           to_char(e.scheduled_at, 'YYYY-MM-DD') as detail,
           null as url
    from company_events e
    join securities s on s.id = e.security_id
    join watchlist_items w on w.security_id = s.id
    where e.scheduled_at between ${now.toISOString()}::timestamptz and ${horizon.toISOString()}::timestamptz
    order by e.scheduled_at
    limit 10
  `);
  return [...rows];
}

function bullets(rows: Row[], format: (r: Row) => string): string[] {
  return rows.map(format);
}

/** Trim a snippet to one line without cutting mid-word. */
function clip(text: string | null, max = 140): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", max))}…`;
}

export interface DigestSources {
  alerts: Row[];
  filings: Row[];
  news: Row[];
  events: Row[];
  /** One pre-formatted line, or null when there is no portfolio. */
  portfolioLine: string | null;
  since: Date;
  now: Date;
}

export function composeDigest(src: DigestSources): DigestContent {
  const { alerts, filings, news, events, since, now } = src;
  const sections: DigestSection[] = [];

  /*
   * Anything an alert already reported is dropped from the sections below it.
   *
   * The same 8-K arriving as both "a rule you wrote fired" and "a filing
   * appeared" is one event, and saying it twice in one screen is how a digest
   * teaches you to skim past it. The alert wins because it is the thing the
   * reader explicitly asked for; the generic section is what catches
   * everything nobody wrote a rule about.
   */
  const claimed = new Set(alerts.map((a) => a.url).filter(Boolean) as string[]);

  if (alerts.length) {
    sections.push({
      heading: "Alerts that fired",
      lines: bullets(alerts, (r) =>
        `**${r.title}** — ${clip(r.detail)}${r.url ? ` [more](${r.url})` : ""}`,
      ),
    });
  }

  const freshFilings = filings.filter((r) => !r.url || !claimed.has(r.url));
  if (freshFilings.length) {
    sections.push({
      heading: "New filings",
      lines: bullets(freshFilings, (r) =>
        `**${r.ticker} ${r.title}** — ${clip(r.detail) || "no summary generated yet"}${
          r.url ? ` [read](${r.url})` : ""
        }`,
      ),
    });
  }

  const freshNews = news.filter((r) => !r.url || !claimed.has(r.url));
  if (freshNews.length) {
    sections.push({
      heading: "Material news",
      lines: bullets(freshNews, (r) =>
        `**${r.ticker}** ${r.title}${r.url ? ` [read](${r.url})` : ""}${
          r.detail ? `\n  ${clip(r.detail)}` : ""
        }`,
      ),
    });
  }

  if (events.length) {
    sections.push({
      heading: "Coming up this week",
      lines: bullets(events, (r) => `**${r.ticker}** ${r.title} on ${r.detail}`),
    });
  }

  /*
   * The portfolio line is last and is one line. It is the number most likely
   * to be looked at first and least likely to require anything of the reader,
   * and putting it at the top would turn a research digest into a scoreboard.
   */
  if (src.portfolioLine) {
    sections.push({ heading: "Portfolio", lines: [src.portfolioLine] });
  }

  const itemCount = sections.reduce((n, s) => n + s.lines.length, 0);

  /*
   * A quiet morning says so in one sentence rather than being suppressed.
   * A digest that only arrives when something happened trains you to wonder
   * whether it failed, and "nothing happened" is genuinely useful.
   */
  const markdown = sections.length
    ? sections
        .map((s) => `## ${s.heading}\n\n${s.lines.map((l) => `- ${l}`).join("\n")}`)
        .join("\n\n")
    : `Nothing happened to your watchlist companies since ${isoDate(since)}. ` +
      "No filings, no material news, no alerts.";

  return { forDate: now, sections, itemCount, markdown };
}

export async function buildDigest(now: Date): Promise<DigestContent> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);

  const [filings, news, alerts, events, portfolio] = await Promise.all([
    recentFilings(since),
    materialNews(since),
    firedAlerts(since),
    upcomingEvents(now),
    // A ledger problem must not take the digest with it — the news half is
    // still worth sending.
    getPortfolio().catch(() => null),
  ]);

  const portfolioLine =
    portfolio && portfolio.positions.length > 0
      ? `Value ${formatSignedCurrency(D.toNumber(portfolio.totals.marketValue)).replace("+", "")}, ` +
        `unrealised ${formatSignedCurrency(D.toNumber(portfolio.totals.unrealizedGain))}, ` +
        `total return ${formatSignedCurrency(D.toNumber(portfolio.totals.totalReturn))}.`
      : null;

  return composeDigest({
    alerts,
    filings,
    news,
    events,
    portfolioLine,
    since,
    now,
  });
}
