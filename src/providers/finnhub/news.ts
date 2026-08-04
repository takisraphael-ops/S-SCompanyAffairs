import { z } from "zod";
import { fetchJson } from "../http";
import { RateLimiter } from "../rate-limit";
import type { NewsProvider, NewsTarget, RawArticle } from "../types";

const BASE = "https://finnhub.io/api/v1";
const PROVIDER = "finnhub-news";

const limiter = new RateLimiter(20, 1);

const articleSchema = z.object({
  headline: z.string(),
  url: z.string(),
  datetime: z.number(),
  source: z.string().optional(),
  summary: z.string().optional(),
  /** Comma-separated tickers the article is tagged with. */
  related: z.string().optional(),
  category: z.string().optional(),
});

const responseSchema = z.array(articleSchema);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Finnhub's per-company news endpoint.
 *
 * Because the request is made for one symbol, every article it returns is
 * already attributed — that becomes the `feed_query` link in entity
 * resolution and does not depend on text matching at all.
 */
export class FinnhubNewsProvider implements NewsProvider {
  readonly name = PROVIDER;

  constructor(private readonly apiKey: string) {}

  async getCompanyNews(target: NewsTarget, since: Date): Promise<RawArticle[]> {
    const url = new URL(`${BASE}/company-news`);
    url.searchParams.set("symbol", target.ticker);
    url.searchParams.set("from", isoDate(since));
    url.searchParams.set("to", isoDate(new Date()));
    url.searchParams.set("token", this.apiKey);

    const raw = await fetchJson(url.toString(), {
      provider: PROVIDER,
      schema: responseSchema,
      limiter,
      timeoutMs: 20_000,
    });

    return raw
      .filter((a) => a.headline && a.url && a.datetime > 0)
      .map((a) => ({
        title: a.headline,
        url: a.url,
        publishedAt: new Date(a.datetime * 1000),
        snippet: a.summary?.trim() || null,
        publisher: a.source?.trim() || null,
        tickers: a.related
          ? a.related
              .split(",")
              .map((t) => t.trim().toUpperCase())
              .filter(Boolean)
          : [],
        sourceKey: "finnhub",
        sourceName: "Finnhub",
        // Finnhub aggregates other outlets rather than reporting itself.
        sourceKind: "aggregator" as const,
      }));
  }
}
