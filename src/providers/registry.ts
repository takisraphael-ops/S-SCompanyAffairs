import { getEnv } from "@/lib/env";
import { AnthropicProvider } from "./anthropic";
import { EdgarProvider } from "./edgar";
import { FinnhubProvider } from "./finnhub";
import { FinnhubNewsProvider } from "./finnhub/news";
import { MockProvider } from "./mock";
import { MockFundamentalsProvider } from "./mock/fundamentals";
import { MockLlmProvider } from "./mock/llm";
import { MockNewsProvider } from "./mock/news";
import { ConsoleNotifier } from "./mock/notifier";
import { ResendNotifier } from "./resend";
import { RssNewsProvider } from "./rss";
import type {
  CalendarProvider,
  FilingsProvider,
  FundamentalsProvider,
  LlmProvider,
  NewsProvider,
  Notifier,
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

/** EDGAR serves three capabilities at once; the alias keeps that legible. */
type EdgarCapabilities = FilingsProvider & ProfileProvider & FundamentalsProvider;

let quoteProvider: QuoteProvider | null = null;
let filingsProvider: EdgarCapabilities | null = null;

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

/**
 * EDGAR is our filings source, our zero-config profile source, and our
 * fundamentals source. One adapter, three capabilities, no API key.
 */
export function getFilingsProvider(): EdgarCapabilities {
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

let fundamentalsProviders: FundamentalsProvider[] | null = null;
let calendarProviders: CalendarProvider[] | null = null;

/**
 * Fundamentals sources, in priority order.
 *
 * EDGAR first: it is free, authoritative, needs no key, and reports what the
 * company actually filed. The mock exists so the company page is populated
 * with no configuration at all — without it, a fresh install shows an empty
 * page and looks broken.
 */
export function getFundamentalsProviders(): FundamentalsProvider[] {
  if (fundamentalsProviders) return fundamentalsProviders;

  const env = getEnv();
  const built: FundamentalsProvider[] = [];

  if (env.NEWS_PROVIDERS.includes("mock")) {
    built.push(new MockFundamentalsProvider());
  } else {
    built.push(getFilingsProvider());
  }

  fundamentalsProviders = built;
  return fundamentalsProviders;
}

/** Earnings and dividend calendar sources. */
export function getCalendarProviders(): CalendarProvider[] {
  if (calendarProviders) return calendarProviders;

  const env = getEnv();
  // Only the mock supplies a calendar today; a real one lands with a paid
  // plan. Returning an empty list degrades the events strip rather than
  // failing the ingest.
  calendarProviders = env.NEWS_PROVIDERS.includes("mock")
    ? [new MockFundamentalsProvider()]
    : [];
  return calendarProviders;
}

let emailNotifier: Notifier | null = null;

/**
 * The email channel.
 *
 * Falls back to printing rather than failing when nothing is configured, so a
 * rule set to `email` on an install with no key still produces a visible
 * record instead of disappearing. The caller records which notifier accepted
 * a message, so "printed to a log" is never mistaken for "sent".
 */
export function getEmailNotifier(): Notifier {
  if (emailNotifier) return emailNotifier;

  const env = getEnv();
  switch (env.EMAIL_PROVIDER) {
    case "resend":
      // Presence of all three is enforced by the env schema.
      emailNotifier = new ResendNotifier(
        env.RESEND_API_KEY!,
        env.EMAIL_FROM!,
        env.EMAIL_TO!,
      );
      break;
    case "console":
    default:
      emailNotifier = new ConsoleNotifier();
      break;
  }
  return emailNotifier;
}

/** Whether email will actually leave the machine. Drives UI copy. */
export function isEmailConfigured(): boolean {
  return getEnv().EMAIL_PROVIDER !== "console";
}

let llmProvider: LlmProvider | null = null;

/**
 * The text generator.
 *
 * One-of rather than a set: unlike news, where more sources mean better
 * coverage, two models answering the same question produce two answers and no
 * way to choose between them.
 */
export function getLlmProvider(): LlmProvider {
  if (llmProvider) return llmProvider;

  const env = getEnv();
  switch (env.LLM_PROVIDER) {
    case "anthropic":
      // Presence of the key is enforced by the env schema.
      llmProvider = new AnthropicProvider(env.ANTHROPIC_API_KEY!, {
        fast: env.ANTHROPIC_FAST_MODEL,
        careful: env.ANTHROPIC_MODEL,
      });
      break;
    case "mock":
    default:
      llmProvider = new MockLlmProvider();
      break;
  }
  return llmProvider;
}

/** Whether generated text will come from a real model. Drives UI labelling. */
export function isLlmConfigured(): boolean {
  return getEnv().LLM_PROVIDER !== "mock";
}

/** Test seam. */
export function resetProviderCache(): void {
  quoteProvider = null;
  filingsProvider = null;
  newsProviders = null;
  fundamentalsProviders = null;
  calendarProviders = null;
  llmProvider = null;
  emailNotifier = null;
}
