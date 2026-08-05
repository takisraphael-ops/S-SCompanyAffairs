import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { EventType } from "@/db/schema";

export interface FeedItem {
  articleId: string;
  storyId: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: Date;
  snippet: string | null;
  eventType: EventType;
  materiality: number;
  sourceName: string;
  /** How many articles are in this story, including the canonical one. */
  articleCount: number;
  relevance: number;
  /** Tickers this article was linked to, for cross-mention display. */
  tickers: string[];
}

/** Index signature required by drizzle's `execute` row generic. */
interface RawFeedRow extends Record<string, unknown> {
  article_id: string;
  story_id: string;
  title: string;
  url: string;
  publisher: string | null;
  published_at: Date;
  snippet: string | null;
  event_type: EventType;
  materiality: string;
  source_name: string;
  article_count: number;
  relevance: string;
  tickers: string[] | null;
}

/**
 * One row per story, choosing the best-sourced article to represent it.
 *
 * `DISTINCT ON (story_id)` with an ordering of source weight then earliest
 * publication picks the canonical copy: prefer the company's own wire release
 * over an aggregator's restatement, and prefer whoever ran it first. Writing
 * this as SQL rather than through the query builder keeps the intent legible
 * — the ordering *is* the canonical-selection rule.
 */
function canonicalStoryQuery(filter: {
  securityIds?: string[];
  minRelevance: number;
  limit: number;
}) {
  /*
   * Bound as one array parameter rather than interpolated into the string.
   * These ids come from our own tables today, but string-building SQL is how
   * that quietly stops being true.
   *
   * `sql.param` is required: a bare `${array}` in a drizzle template expands
   * to one placeholder per element, which turns `any($1,$2,$3)::uuid[]` into a
   * cast of a record and fails at the database.
   */
  const securityFilter = filter.securityIds
    ? sql`and l.security_id = any(${sql.param(filter.securityIds)}::uuid[])`
    : sql``;

  return sql`
    with linked as (
      select
        a.id            as article_id,
        a.story_id      as story_id,
        a.title,
        a.url_original  as url,
        a.publisher,
        a.published_at,
        a.snippet,
        a.event_type,
        a.materiality,
        s.name          as source_name,
        s.weight        as source_weight,
        st.article_count,
        max(l.relevance) as relevance
      from article_links l
      join articles a   on a.id = l.article_id
      join news_sources s on s.id = a.source_id
      join stories st   on st.id = a.story_id
      where l.relevance >= ${String(filter.minRelevance)}
      ${securityFilter}
      group by a.id, s.id, st.id
    ),
    canonical as (
      select distinct on (story_id) *
      from linked
      order by story_id, source_weight desc, published_at asc
    )
    select
      c.article_id,
      c.story_id,
      c.title,
      c.url,
      c.publisher,
      c.published_at,
      c.snippet,
      c.event_type,
      c.materiality,
      c.source_name,
      c.article_count,
      c.relevance,
      (
        select array_agg(distinct sec.ticker order by sec.ticker)
        from article_links l2
        join securities sec on sec.id = l2.security_id
        where l2.article_id = c.article_id
      ) as tickers
    from canonical c
    order by c.published_at desc
    limit ${filter.limit}
  `;
}

function toFeedItem(row: RawFeedRow): FeedItem {
  return {
    articleId: row.article_id,
    storyId: row.story_id,
    title: row.title,
    url: row.url,
    publisher: row.publisher,
    publishedAt: new Date(row.published_at),
    snippet: row.snippet,
    eventType: row.event_type,
    materiality: Number(row.materiality),
    sourceName: row.source_name,
    articleCount: row.article_count,
    relevance: Number(row.relevance),
    tickers: row.tickers ?? [],
  };
}

/** News for one company. */
export async function listCompanyNews(
  securityId: string,
  opts: { limit?: number; minRelevance?: number } = {},
): Promise<FeedItem[]> {
  const rows = await getDb().execute<RawFeedRow>(
    canonicalStoryQuery({
      securityIds: [securityId],
      minRelevance: opts.minRelevance ?? 0.5,
      limit: opts.limit ?? 60,
    }),
  );
  return [...rows].map(toFeedItem);
}

/** News across every company on the watchlist. */
export async function listWatchlistNews(
  opts: { limit?: number; minRelevance?: number } = {},
): Promise<FeedItem[]> {
  const db = getDb();

  const ids = await db.execute<{ id: string }>(
    sql`select s.id from watchlist_items w join securities s on s.id = w.security_id`,
  );
  const securityIds = [...ids].map((r) => r.id);
  if (securityIds.length === 0) return [];

  const rows = await db.execute<RawFeedRow>(
    canonicalStoryQuery({
      securityIds,
      minRelevance: opts.minRelevance ?? 0.5,
      limit: opts.limit ?? 80,
    }),
  );
  return [...rows].map(toFeedItem);
}

/** Every article in a story, best-sourced first — the "+N similar" expansion. */
export async function listStoryArticles(storyId: string) {
  const rows = await getDb().execute<{
    id: string;
    title: string;
    url: string;
    publisher: string | null;
    published_at: Date;
    source_name: string;
  }>(sql`
    select a.id, a.title, a.url_original as url, a.publisher,
           a.published_at, s.name as source_name
    from articles a
    join news_sources s on s.id = a.source_id
    where a.story_id = ${storyId}
    order by s.weight desc, a.published_at asc
  `);

  return [...rows].map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    publisher: r.publisher,
    publishedAt: new Date(r.published_at),
    sourceName: r.source_name,
  }));
}

/**
 * Link counts by resolution method — the measurement the plan calls for, so
 * relevance rules can be tuned against evidence rather than intuition.
 */
export async function getLinkMethodStats(): Promise<
  Array<{ method: string; count: number; avgRelevance: number }>
> {
  const rows = await getDb().execute<{
    method: string;
    count: number;
    avg_relevance: string;
  }>(sql`
    select method, count(*)::int as count, avg(relevance) as avg_relevance
    from article_links
    group by method
    order by count desc
  `);

  return [...rows].map((r) => ({
    method: r.method,
    count: r.count,
    avgRelevance: Number(r.avg_relevance),
  }));
}
