import { z } from "zod";
import { ProviderError } from "../errors";
import { fetchJson } from "../http";
import { RateLimiter } from "../rate-limit";
import type {
  Bar,
  CompanyProfile,
  ProfileProvider,
  Quote,
  QuoteProvider,
} from "../types";

const BASE = "https://finnhub.io/api/v1";
const PROVIDER = "finnhub";

/**
 * Free tier documents 60 calls/minute. Sustained 1/s with a small burst keeps
 * us clear of it without serialising the whole watchlist unnecessarily.
 */
const limiter = new RateLimiter(20, 1);

const quoteSchema = z.object({
  c: z.number(), // current
  d: z.number().nullish(), // change
  dp: z.number().nullish(), // change percent
  h: z.number().nullish(), // day high
  l: z.number().nullish(), // day low
  o: z.number().nullish(), // open
  pc: z.number().nullish(), // previous close
  t: z.number().nullish(), // unix seconds
});

const profileSchema = z.object({
  ticker: z.string().optional(),
  name: z.string().optional(),
  exchange: z.string().optional(),
  finnhubIndustry: z.string().optional(),
});

const candleSchema = z.object({
  s: z.string(),
  t: z.array(z.number()).optional(),
  o: z.array(z.number()).optional(),
  h: z.array(z.number()).optional(),
  l: z.array(z.number()).optional(),
  c: z.array(z.number()).optional(),
  v: z.array(z.number()).optional(),
});

function url(path: string, params: Record<string, string>, apiKey: string) {
  const u = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("token", apiKey);
  return u.toString();
}

export class FinnhubProvider implements QuoteProvider, ProfileProvider {
  readonly name = PROVIDER;

  /** Unknown symbols come back as `not_found` below, so a quote means real. */
  readonly canVerifySymbols = true;

  constructor(private readonly apiKey: string) {}

  async getQuote(ticker: string): Promise<Quote> {
    const raw = await fetchJson(
      url("/quote", { symbol: ticker }, this.apiKey),
      { provider: PROVIDER, schema: quoteSchema, limiter },
    );

    // Finnhub answers 200 with an all-zero body for symbols it does not know,
    // rather than 404. Treat that as not_found or we would persist a $0 price.
    if (raw.c === 0 && (raw.pc ?? 0) === 0 && (raw.t ?? 0) === 0) {
      throw new ProviderError(`finnhub: no quote data for ${ticker}`, {
        provider: PROVIDER,
        code: "not_found",
      });
    }

    return {
      ticker,
      price: raw.c,
      previousClose: raw.pc ?? null,
      change: raw.d ?? null,
      changePct: raw.dp ?? null,
      dayHigh: raw.h ?? null,
      dayLow: raw.l ?? null,
      open: raw.o ?? null,
      asOf: raw.t ? new Date(raw.t * 1000) : new Date(),
    };
  }

  async getProfile(ticker: string): Promise<CompanyProfile | null> {
    const raw = await fetchJson(
      url("/stock/profile2", { symbol: ticker }, this.apiKey),
      { provider: PROVIDER, schema: profileSchema, limiter },
    );

    // Unknown symbol yields `{}`.
    if (!raw.name) return null;

    return {
      ticker,
      name: raw.name,
      exchange: raw.exchange ?? null,
      cik: null, // Finnhub does not expose CIK; EDGAR resolves it.
      sector: null,
      industry: raw.finnhubIndustry ?? null,
    };
  }

  async getDailyBars(ticker: string, from: Date, to: Date): Promise<Bar[]> {
    let raw;
    try {
      raw = await fetchJson(
        url(
          "/stock/candle",
          {
            symbol: ticker,
            resolution: "D",
            from: String(Math.floor(from.getTime() / 1000)),
            to: String(Math.floor(to.getTime() / 1000)),
          },
          this.apiKey,
        ),
        { provider: PROVIDER, schema: candleSchema, limiter },
      );
    } catch (err) {
      // Historical candles moved behind a paid plan. Surface this as
      // `unsupported` so ingest can fall back to building history forward
      // from daily quotes instead of failing the run.
      if (
        err instanceof ProviderError &&
        (err.code === "unauthorized" || err.status === 403)
      ) {
        throw new ProviderError(
          "finnhub: /stock/candle requires a paid plan on this API key",
          { provider: PROVIDER, code: "unsupported", cause: err },
        );
      }
      throw err;
    }

    if (raw.s !== "ok" || !raw.t || !raw.c) return [];

    const bars: Bar[] = [];
    for (let i = 0; i < raw.t.length; i++) {
      const ts = raw.t[i];
      const close = raw.c[i];
      if (ts == null || close == null) continue;
      bars.push({
        ts: new Date(ts * 1000),
        open: raw.o?.[i] ?? null,
        high: raw.h?.[i] ?? null,
        low: raw.l?.[i] ?? null,
        close,
        volume: raw.v?.[i] ?? null,
      });
    }
    return bars;
  }
}
