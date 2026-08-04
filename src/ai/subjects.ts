import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  articles,
  concepts,
  conceptMetrics,
  filings,
  newsSources,
  securities,
  type ConceptLevel,
} from "@/db/schema";
import { formatMetricValue } from "@/lib/derive";
import { toNumber } from "@/lib/format";
import { getLatestFundamentals, getMetricHistory } from "@/services/fundamentals";
import { getQuoteFor } from "@/services/watchlist";
import { metricSubject } from "./cache";
import {
  articleClassificationPrompt,
  filingSummaryPrompt,
  metricExplanationPrompt,
  storySummaryPrompt,
  type PromptSpec,
} from "./prompts";

/**
 * Assembling a prompt's inputs out of the database.
 *
 * This layer exists so `prompts.ts` can stay pure and testable: everything
 * that needs a query happens here, everything that needs judgement happens
 * there. It is also the single place that knows a prompt's subject key, which
 * is what the cache is looked up by — so a caller cannot read one subject and
 * write another.
 */

export interface BuiltPrompt {
  spec: PromptSpec;
  subjectKey: string;
  securityId: string | null;
}

/* ------------------------------------------------------------------ *
 * Stories
 * ------------------------------------------------------------------ */

export async function buildStoryPrompt(
  storyId: string,
): Promise<BuiltPrompt | null> {
  const db = getDb();

  const rows = await db
    .select({
      title: articles.title,
      publisher: articles.publisher,
      publishedAt: articles.publishedAt,
      snippet: articles.snippet,
      eventType: articles.eventType,
      sourceName: newsSources.name,
      weight: newsSources.weight,
    })
    .from(articles)
    .innerJoin(newsSources, eq(newsSources.id, articles.sourceId))
    .where(eq(articles.storyId, storyId))
    // Best-sourced first, matching how the feed picks the canonical copy, so
    // the model reads the wire release before an aggregator's restatement.
    .orderBy(desc(newsSources.weight), articles.publishedAt);

  if (rows.length === 0) return null;

  const linked = await db.execute<{ ticker: string; name: string; id: string }>(sql`
    select distinct s.id, s.ticker, s.name
    from article_links l
    join articles a on a.id = l.article_id
    join securities s on s.id = l.security_id
    where a.story_id = ${storyId}
    order by s.ticker
  `);
  const companies = [...linked];

  const spec = storySummaryPrompt({
    companies: companies.map((c) => ({ ticker: c.ticker, name: c.name })),
    eventType: rows[0]!.eventType,
    articles: rows.map((r) => ({
      title: r.title,
      publisher: r.publisher,
      sourceName: r.sourceName,
      publishedAt: r.publishedAt,
      snippet: r.snippet,
    })),
  });

  return {
    spec,
    subjectKey: storyId,
    // Only attributed when a story concerns exactly one company; the column
    // exists for cascade deletion, and a story about two would have to pick.
    securityId: companies.length === 1 ? companies[0]!.id : null,
  };
}

/* ------------------------------------------------------------------ *
 * Filings
 * ------------------------------------------------------------------ */

export async function buildFilingPrompt(
  filingId: string,
): Promise<BuiltPrompt | null> {
  const rows = await getDb()
    .select({
      id: filings.id,
      formType: filings.formType,
      filedAt: filings.filedAt,
      description: filings.description,
      securityId: filings.securityId,
      ticker: securities.ticker,
      name: securities.name,
    })
    .from(filings)
    .innerJoin(securities, eq(securities.id, filings.securityId))
    .where(eq(filings.id, filingId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    spec: filingSummaryPrompt({
      ticker: row.ticker,
      companyName: row.name,
      formType: row.formType,
      filedAt: row.filedAt,
      description: row.description,
    }),
    subjectKey: row.id,
    securityId: row.securityId,
  };
}

/* ------------------------------------------------------------------ *
 * Metric explanations
 * ------------------------------------------------------------------ */

/**
 * The prompt for "why is this company's figure what it is".
 *
 * Returns null when the metric is not on the company's latest period, which
 * is the same condition under which the page does not display it — there is
 * nothing to explain about a figure nobody is looking at.
 *
 * `level` is passed in rather than read here so this stays callable from a
 * batch job, where there is no request and no user.
 */
export async function buildMetricPrompt(
  securityId: string,
  metricKey: string,
  level: ConceptLevel,
): Promise<BuiltPrompt | null> {
  const db = getDb();

  const secRows = await db
    .select()
    .from(securities)
    .where(eq(securities.id, securityId))
    .limit(1);
  const security = secRows[0];
  if (!security) return null;

  const quote = await getQuoteFor(securityId);
  const snapshot = await getLatestFundamentals(securityId, {
    price: toNumber(quote?.price),
  });
  if (!snapshot) return null;

  const metric = snapshot.metrics.find((m) => m.metricKey === metricKey);
  if (!metric) return null;

  // The authored definition, so the model is told what has already been said.
  const conceptRows = await db
    .select({ term: concepts.term, oneLiner: concepts.oneLiner })
    .from(conceptMetrics)
    .innerJoin(concepts, eq(concepts.id, conceptMetrics.conceptId))
    .where(eq(conceptMetrics.metricKey, metricKey))
    .limit(1);
  const concept = conceptRows[0];
  if (!concept) return null;

  const history = await getMetricHistory(securityId, metricKey, {
    periodType: snapshot.periodType,
    limit: 5,
  });

  const spec = metricExplanationPrompt({
    ticker: security.ticker,
    companyName: security.name,
    industry: security.industry,
    metricKey,
    term: concept.term,
    oneLiner: concept.oneLiner,
    formatted: formatMetricValue(metric.value, metric.unit),
    origin: metric.origin,
    periodEnd: snapshot.periodEnd,
    periodType: snapshot.periodType,
    context: snapshot.metrics
      .filter((m) => m.metricKey !== metricKey)
      .map((m) => ({
        metricKey: m.metricKey,
        formatted: formatMetricValue(m.value, m.unit),
      })),
    history: history.map((h) => ({
      periodEnd: h.periodEnd,
      formatted: formatMetricValue(h.value, h.unit),
    })),
    level,
  });

  return {
    spec,
    subjectKey: metricSubject(securityId, metricKey),
    securityId,
  };
}

/* ------------------------------------------------------------------ *
 * Article classification
 * ------------------------------------------------------------------ */

export async function buildArticlePrompt(
  articleId: string,
): Promise<BuiltPrompt | null> {
  const db = getDb();

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      snippet: articles.snippet,
      publisher: articles.publisher,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const linked = await db.execute<{ name: string; ticker: string }>(sql`
    select s.name, s.ticker
    from article_links l
    join securities s on s.id = l.security_id
    where l.article_id = ${articleId}
    order by s.ticker
  `);

  return {
    spec: articleClassificationPrompt({
      title: row.title,
      snippet: row.snippet,
      publisher: row.publisher,
      companies: [...linked].map((c) => `${c.name} (${c.ticker})`),
    }),
    subjectKey: row.id,
    securityId: null,
  };
}

/** Metrics on a company's latest period that have an authored explanation. */
export async function listExplainableMetrics(
  securityId: string,
): Promise<Set<string>> {
  const quote = await getQuoteFor(securityId);
  const snapshot = await getLatestFundamentals(securityId, {
    price: toNumber(quote?.price),
  });
  if (!snapshot) return new Set();

  const mapped = await getDb()
    .select({ metricKey: conceptMetrics.metricKey })
    .from(conceptMetrics);
  const explainable = new Set(mapped.map((m) => m.metricKey));

  return new Set(
    snapshot.metrics
      .map((m) => m.metricKey)
      .filter((k) => explainable.has(k)),
  );
}
