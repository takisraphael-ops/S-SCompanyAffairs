import { getEnv } from "@/lib/env";
import { EdgarProvider } from "./edgar";
import { FinnhubProvider } from "./finnhub";
import { FinnhubNewsProvider } from "./finnhub/news";
import { MockProvider } from "./mock";
import { MockNewsProvider } from "./mock/news";
import { RssNewsProvider } from "./rss";
import type {
  FilingsProvider,
  NewsProvider,
  ProfileProvider,
  QuoteProvider,
} from "./types";

/**
 * Resolves capability interfaces to concrete adapters from configuration.
 *
 * This is the seam that makes "start on free tiers, upgrade later" a config
 * change: adding Polygon means writing an adapter and one more case here.
 * Nothing downstream imports an adapter directly.
 */

let quoteProvider: QuoteProvider | null = null;
let filingsProvider: (FilingsProvider & ProfileProvider) | null = null;

export function getQuoteProvider(): QuoteProvider {
  if (quoteProvider) return quoteProvider;

  const env = getEnv();
  switch (env.QUOTE_PROVIDER) {
    case "finnhub":
      // Presence of the key is enforced by the env schema.
      quoteProvider = new FinnhubProvider(env.FINNHUB_API_KEY!);
      break;
    case "mock":
    default:
      quoteProvider = new MockProvider();
      break;
  }
  return quoteProvider;
}

/** EDGAR is both our filings source and our zero-config profile source. */
export function getFilingsProvider(): FilingsProvider & ProfileProvider {
  if (!filingsProvider) {
    filingsProvider = new EdgarProvider(getEnv().SEC_USER_AGENT);
  }
  return filingsProvider;
}

/**
 * Richer company metadata when a Finnhub key is configured, EDGAR otherwise.
 * Returns null when neither can add anything beyond what EDGAR already gives.
 */
export function getSupplementalProfileProvider(): ProfileProvider | null {
  const env = getEnv();
  if (env.QUOTE_PROVIDER === "finnhub" && env.FINNHUB_API_KEY) {
    const p = getQuoteProvider();
    if (p instanceof FinnhubProvider) return p;
  }
  return null;
}

let newsProviders: NewsProvider[] | null = null;

/**
 * News adapters run as a set rather than one-of.
 *
 * Coverage is the constraint that matters: no single free source sees
 * everything, and story clustering already collapses the overlap that running
 * several produces. Adding a source is therefore cheap, and dropping one
 * degrades coverage rather than breaking the feed.
 */
export function getNewsProviders(): NewsProvider[] {
  if (newsProviders) return newsProviders;

  const env = getEnv();
  const built: NewsProvider[] = [];

  for (const key of env.NEWS_PROVIDERS) {
    switch (key) {
      case "finnhub":
        built.push(new FinnhubNewsProvider(env.FINNHUB_API_KEY!));
        break;
      case "rss":
        built.push(new RssNewsProvider());
        break;
      case "mock":
        built.push(new MockNewsProvider());
        break;
    }
  }

  newsProviders = built;
  return newsProviders;
}

/** Test seam. */
export function resetProviderCache(): void {
  quoteProvider = null;
  filingsProvider = null;
  newsProviders = null;
}
