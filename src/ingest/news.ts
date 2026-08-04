import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  articleLinks,
  articles,
  ingestRuns,
  newsSources,
  securities,
  stories,
  watchlistItems,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { simhash, toHex } from "@/lib/simhash";
import { normalizeTitle, tokenize } from "@/lib/text";
import { canonicalizeUrl, hostnameOf } from "@/lib/url";
import {
  DEFAULT_SOURCE_WEIGHT,
  classifyEvent,
  materialityScore,
} from "@/news/classify";
import { decideStory, type DedupCandidate } from "@/news/dedup";
import { resolveEntities, type EntityCandidate } from "@/news/entities";
import { isProviderError } from "@/providers/errors";
import { getNewsProviders } from "@/providers/registry";
import type { RawArticle } from "@/providers/types";

export interface NewsIngestResult {
  runId: string;
  job: string;
  status: "ok" | "partial" | "failed";
  fetched: number;
  inserted: number;
  duplicateUrls: number;
  clustered: number;
  linked: number;
  failed: number;
  errors: Array<{ target: string; message: string }>;
}

/**
 * How far back to look for articles a new one might duplicate.
 *
 * Syndication happens within hours, so a short window catches essentially all
 * of it while keeping the candidate set small enough to compare in memory.
 */
const DEDUP_WINDOW_DAYS = 14;

/** Ensure a source row exists and return its id and weight. */
async function upsertSource(article: RawArticle): Promise<{
  id: string;
  weight: number;
}> {
  const db = getDb();
  const defaultWeight = DEFAULT_SOURCE_WEIGHT[article.sourceKind] ?? 0.5;

  const [row] = await db
    .insert(newsSources)
    .values({
      key: article.sourceKey,
      name: article.sourceName,
      kind: article.sourceKind,
      weight: String(defaultWeight),
    })
    // Do not overwrite weight: an operator may have tuned it deliberately.
    .onConflictDoUpdate({
      target: newsSources.key,
      set: { name: article.sourceName },
    })
    .returning({ id: newsSources.id, weight: newsSources.weight });

  if (!row) throw new Error(`could not upsert source ${article.sourceKey}`);
  return { id: row.id, weight: Number(row.weight) };
}

/**
 * Persist one raw article: cluster it, classify it, and link it to the
 * companies it concerns.
 *
 * Runs in a transaction so a story's article count can never drift from the
 * articles actually attached to it.
 */
async function persistArticle(
  raw: RawArticle,
  candidates: EntityCandidate[],
  fetchedForSecurityId: string,
): Promise<"inserted" | "duplicate" | "clustered"> {
  const db = getDb();

  const urlCanonical = canonicalizeUrl(raw.url);
  const titleNormalized = normalizeTitle(raw.title);
  if (!titleNormalized) return "duplicate"; // nothing to compare on

  const fingerprint = toHex(
    simhash([
      ...tokenize(titleNormalized),
      ...tokenize(normalizeTitle(raw.snippet ?? "")).slice(0, 40),
    ]),
  );

  const source = await upsertSource(raw);

  return db.transaction(async (tx) => {
    // Already have this exact URL — the commonest case on a repeat run.
    const existing = await tx
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.urlCanonical, urlCanonical))
      .limit(1);
    if (existing[0]) return "duplicate";

    const windowStart = new Date(
      Date.now() - DEDUP_WINDOW_DAYS * 86_400_000,
    );

    /*
     * Candidates are scoped to articles already linked to this company.
     *
     * Corporate headlines are templated, so without this scope "Apple Reports
     * Third Quarter Results" and "Microsoft Reports Third Quarter Results"
     * clear the similarity bar and merge — silently hiding one company's
     * earnings behind another's. Two articles about different companies are
     * never the same story, and this join is what enforces it.
     */
    const dedupCandidates: DedupCandidate[] = await tx
      .selectDistinct({
        id: articles.id,
        storyId: articles.storyId,
        titleNormalized: articles.titleNormalized,
        simhash: articles.simhash,
      })
      .from(articles)
      .innerJoin(articleLinks, eq(articleLinks.articleId, articles.id))
      .where(
        and(
          eq(articleLinks.securityId, fetchedForSecurityId),
          gte(articles.publishedAt, windowStart),
        ),
      )
      .limit(2000);

    const decision = decideStory(
      { titleNormalized, simhash: fingerprint },
      dedupCandidates,
    );

    let storyId: string;
    let clustered = false;

    if (decision.kind === "existing-story") {
      storyId = decision.storyId;
      clustered = true;
      await tx
        .update(stories)
        .set({
          lastSeenAt: new Date(),
          articleCount: sql`${stories.articleCount} + 1`,
        })
        .where(eq(stories.id, storyId));
    } else {
      const [story] = await tx
        .insert(stories)
        .values({
          firstSeenAt: raw.publishedAt,
          lastSeenAt: new Date(),
          articleCount: 1,
        })
        .returning({ id: stories.id });
      if (!story) throw new Error("could not create story");
      storyId = story.id;
    }

    const event = classifyEvent(raw.title, raw.snippet);

    const [inserted] = await tx
      .insert(articles)
      .values({
        sourceId: source.id,
        storyId,
        urlCanonical,
        urlOriginal: raw.url,
        title: raw.title,
        titleNormalized,
        publisher: raw.publisher ?? hostnameOf(raw.url),
        publishedAt: raw.publishedAt,
        snippet: raw.snippet ?? null,
        simhash: fingerprint,
        eventType: event,
        materiality: String(materialityScore(event, source.weight)),
      })
      // Two providers can deliver the same URL inside one run.
      .onConflictDoNothing({ target: articles.urlCanonical })
      .returning({ id: articles.id });

    if (!inserted) return "duplicate";

    const matches = resolveEntities(
      { title: raw.title, snippet: raw.snippet },
      candidates,
      { fetchedForSecurityId, providerTickers: raw.tickers },
    );

    if (matches.length > 0) {
      await tx
        .insert(articleLinks)
        .values(
          matches.map((m) => ({
            articleId: inserted.id,
            securityId: m.securityId,
            relevance: String(m.relevance),
            method: m.method,
          })),
        )
        .onConflictDoNothing();
    }

    return clustered ? "clustered" : "inserted";
  });
}

/**
 * Fetch and store news for every security on the watchlist.
 *
 * Each (security, provider) pair is isolated: a provider outage or a single
 * malformed article degrades coverage rather than failing the run.
 */
export async function ingestNews(): Promise<NewsIngestResult> {
  const db = getDb();
  const env = getEnv();
  const job = "news";

  const [run] = await db
    .insert(ingestRuns)
    .values({ job, status: "running" })
    .returning({ id: ingestRuns.id });
  if (!run) throw new Error("could not create ingest run");

  const watchlist = await db
    .select({
      securityId: securities.id,
      ticker: securities.ticker,
      name: securities.name,
      aliases: securities.aliases,
    })
    .from(watchlistItems)
    .innerJoin(securities, eq(watchlistItems.securityId, securities.id));

  // Every watchlist company is a candidate for every article, which is what
  // lets a supply-agreement story attach to both parties.
  const candidates: EntityCandidate[] = watchlist.map((w) => ({
    securityId: w.securityId,
    ticker: w.ticker,
    name: w.name,
    aliases: w.aliases,
  }));

  const providers = getNewsProviders();
  const since = new Date(Date.now() - env.NEWS_LOOKBACK_DAYS * 86_400_000);

  const errors: NewsIngestResult["errors"] = [];
  let fetched = 0;
  let inserted = 0;
  let duplicateUrls = 0;
  let clustered = 0;

  for (const target of watchlist) {
    for (const provider of providers) {
      try {
        const raw = await provider.getCompanyNews(
          {
            securityId: target.securityId,
            ticker: target.ticker,
            name: target.name,
          },
          since,
        );
        fetched += raw.length;

        for (const article of raw) {
          try {
            const outcome = await persistArticle(
              article,
              candidates,
              target.securityId,
            );
            if (outcome === "inserted") inserted++;
            else if (outcome === "clustered") clustered++;
            else duplicateUrls++;
          } catch (err) {
            errors.push({
              target: `${target.ticker}/${provider.name}/${article.url}`,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        errors.push({
          target: `${target.ticker}/${provider.name}`,
          message:
            isProviderError(err) || err instanceof Error
              ? err.message
              : String(err),
        });
      }
    }
  }

  const linked = await countLinks(watchlist.map((w) => w.securityId));

  const status: NewsIngestResult["status"] =
    errors.length === 0
      ? "ok"
      : inserted + clustered + duplicateUrls === 0 && watchlist.length > 0
        ? "failed"
        : "partial";

  await db
    .update(ingestRuns)
    .set({
      status,
      finishedAt: new Date(),
      itemsOk: inserted + clustered,
      itemsFailed: errors.length,
      error: errors.length
        ? errors.map((e) => `${e.target}: ${e.message}`).join("\n").slice(0, 4000)
        : null,
    })
    .where(eq(ingestRuns.id, run.id));

  return {
    runId: run.id,
    job,
    status,
    fetched,
    inserted,
    duplicateUrls,
    clustered,
    linked,
    failed: errors.length,
    errors,
  };
}

async function countLinks(securityIds: string[]): Promise<number> {
  if (securityIds.length === 0) return 0;
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(articleLinks)
    .where(inArray(articleLinks.securityId, securityIds));
  return rows[0]?.n ?? 0;
}

/**
 * Drop articles past the retention window, then any story left with nothing
 * attached. Stories are referenced *by* articles, so cascade does not reach
 * them and they would otherwise accumulate as empty rows forever.
 */
export async function pruneOldArticles(retentionDays = 180): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  const deleted = await db
    .delete(articles)
    .where(lt(articles.publishedAt, cutoff))
    .returning({ id: articles.id });

  await db.execute(
    sql`delete from ${stories} s
        where not exists (
          select 1 from ${articles} a where a.story_id = s.id
        )`,
  );

  return deleted.length;
}
