import { XMLParser } from "fast-xml-parser";
import { ProviderError } from "../errors";
import { redact } from "../http";
import { RateLimiter, sleep } from "../rate-limit";
import type { NewsProvider, NewsTarget, RawArticle } from "../types";

const PROVIDER = "rss";

/** Polite pacing; these are other people's servers and there is no quota API. */
const limiter = new RateLimiter(4, 2);

/**
 * A feed to poll, with `{ticker}` and `{name}` substituted per company.
 *
 * Google News search feeds are the workhorse: free, no key, no quota, and
 * they surface the long tail that a single provider misses. Direct investor
 * relations feeds would rank higher and can be added per company later.
 */
export interface FeedTemplate {
  key: string;
  name: string;
  kind: "aggregator" | "wire" | "ir" | "outlet";
  urlTemplate: string;
}

export const DEFAULT_FEEDS: FeedTemplate[] = [
  {
    key: "rss:google-news",
    name: "Google News",
    kind: "aggregator",
    urlTemplate:
      "https://news.google.com/rss/search?q=%22{name}%22+OR+%22{ticker}+stock%22&hl=en-US&gl=US&ceid=US:en",
  },
];

/** RSS 2.0 and Atom, reduced to the fields we need. */
interface FeedEntry {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
  description?: unknown;
  summary?: unknown;
  content?: unknown;
  source?: unknown;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Feeds are inconsistent about wrapping single items in arrays.
  isArray: (name) => name === "item" || name === "entry",
});

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Atom often nests text as { "#text": "..." } or carries href attributes.
    const text = record["#text"];
    if (typeof text === "string") return text.trim() || null;
    const href = record["@_href"];
    if (typeof href === "string") return href.trim() || null;
  }
  return null;
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function entryLink(entry: FeedEntry): string | null {
  const direct = asText(entry.link);
  if (direct) return direct;

  // Atom may carry several <link> elements; prefer rel="alternate".
  if (Array.isArray(entry.link)) {
    const alternate = entry.link.find(
      (l) =>
        l &&
        typeof l === "object" &&
        (l as Record<string, unknown>)["@_rel"] !== "self",
    );
    return asText(alternate);
  }
  return null;
}

function entryDate(entry: FeedEntry): Date | null {
  for (const raw of [entry.pubDate, entry.published, entry.updated]) {
    const text = asText(raw);
    if (!text) continue;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/**
 * Google News wraps headlines as "Headline - Publisher"; the publisher is
 * also given in <source>. Prefer the explicit element.
 */
function entryPublisher(entry: FeedEntry): string | null {
  const source = entry.source;
  if (source && typeof source === "object") {
    const text = asText(source);
    if (text) return text;
  }
  return asText(source);
}

/** Parse a feed document into raw articles. Exported for testing. */
export function parseFeed(xml: string, feed: FeedTemplate): RawArticle[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new ProviderError(`${PROVIDER}: could not parse feed ${feed.key}`, {
      provider: PROVIDER,
      code: "invalid_response",
      retryable: false,
      cause: err,
    });
  }

  const rss = doc.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const atom = doc.feed as Record<string, unknown> | undefined;

  const entries = (channel?.item ?? atom?.entry ?? []) as FeedEntry[];
  if (!Array.isArray(entries)) return [];

  const out: RawArticle[] = [];
  for (const entry of entries) {
    const title = asText(entry.title);
    const link = entryLink(entry);
    const publishedAt = entryDate(entry);
    if (!title || !link || !publishedAt) continue;

    const rawSnippet =
      asText(entry.description) ?? asText(entry.summary) ?? asText(entry.content);

    out.push({
      title: stripHtml(title),
      url: link,
      publishedAt,
      snippet: rawSnippet ? stripHtml(rawSnippet).slice(0, 600) || null : null,
      publisher: entryPublisher(entry),
      tickers: [],
      sourceKey: feed.key,
      sourceName: feed.name,
      sourceKind: feed.kind,
    });
  }
  return out;
}

export class RssNewsProvider implements NewsProvider {
  readonly name = PROVIDER;

  constructor(private readonly feeds: FeedTemplate[] = DEFAULT_FEEDS) {}

  private buildUrl(template: string, target: NewsTarget): string {
    return template
      .replace(/\{ticker\}/g, encodeURIComponent(target.ticker))
      .replace(/\{name\}/g, encodeURIComponent(target.name));
  }

  async getCompanyNews(target: NewsTarget, since: Date): Promise<RawArticle[]> {
    const out: RawArticle[] = [];

    for (const feed of this.feeds) {
      const url = this.buildUrl(feed.urlTemplate, target);
      await limiter.acquire();

      try {
        const res = await fetch(url, {
          headers: {
            accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
            // Some feed hosts reject requests without a conventional agent.
            "user-agent": "S-S-Company-Affairs/0.1 (personal watchlist)",
          },
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        });

        if (!res.ok) {
          // One bad feed must not sink the others.
          console.warn(
            `rss: ${res.status} from ${redact(url)} for ${target.ticker}`,
          );
          continue;
        }

        const xml = await res.text();
        // Feeds ignore date filters, so trim client-side.
        out.push(
          ...parseFeed(xml, feed).filter((a) => a.publishedAt >= since),
        );
      } catch (err) {
        console.warn(
          `rss: ${feed.key} failed for ${target.ticker}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Brief pause so a systemic outage does not spin through every feed.
        await sleep(100);
      }
    }

    return out;
  }
}
