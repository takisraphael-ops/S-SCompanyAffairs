import type { Bar, Quote, QuoteProvider } from "../types";

const PROVIDER = "mock";
const MS_PER_DAY = 86_400_000;

/**
 * Deterministic fake market data so the app is fully usable with no API keys.
 *
 * Determinism matters more than realism here: a provider that returned fresh
 * random numbers on every render would make the dashboard look broken and
 * would hide real caching or ingest bugs. The same ticker on the same day
 * always produces the same price, and history joins up with the live quote.
 */

function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Deterministic [0,1) from an integer seed. */
function rand(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function dayIndex(d: Date): number {
  return Math.floor(d.getTime() / MS_PER_DAY);
}

function isWeekend(dayIdx: number): boolean {
  // 1970-01-01 (index 0) was a Thursday.
  const dow = (dayIdx + 4) % 7;
  return dow === 0 || dow === 6;
}

function previousSession(dayIdx: number): number {
  let d = dayIdx - 1;
  while (isWeekend(d)) d--;
  return d;
}

function basePrice(ticker: string): number {
  return 18 + (hashSeed(ticker) % 76_000) / 100; // ~$18–$798
}

/** Closing price for a ticker on a given day index. */
function closeOn(ticker: string, dayIdx: number): number {
  const seed = hashSeed(ticker);
  const base = basePrice(ticker);
  const phase = (seed % 1000) / 1000 * Math.PI * 2;

  // Two overlapping cycles give a plausible trend without needing to walk
  // every prior day, keeping this O(1) for any date.
  const slow = 0.28 * Math.sin(dayIdx / 41 + phase);
  const fast = 0.06 * Math.sin(dayIdx / 6.4 + phase * 1.7);
  const noise = (rand(seed ^ (dayIdx * 2654435761)) - 0.5) * 0.03;

  return Math.max(0.5, base * (1 + slow + fast + noise));
}

export class MockProvider implements QuoteProvider {
  readonly name = PROVIDER;

  /*
   * This provider prices any string it is given — that is the point of it, and
   * it is why it cannot be used to check that a symbol is real. Saying so here
   * keeps typos out of the watchlist on a zero-config install, where EDGAR is
   * left to answer the question alone.
   */
  readonly canVerifySymbols = false;

  async getQuote(ticker: string): Promise<Quote> {
    const today = dayIndex(new Date());
    const session = isWeekend(today) ? previousSession(today) : today;

    const price = closeOn(ticker, session);
    const previousClose = closeOn(ticker, previousSession(session));
    const change = price - previousClose;

    const seed = hashSeed(ticker) ^ session;
    const spread = price * (0.004 + rand(seed) * 0.018);

    return {
      ticker,
      price: round2(price),
      previousClose: round2(previousClose),
      change: round2(change),
      changePct: round2((change / previousClose) * 100),
      dayHigh: round2(Math.max(price, previousClose) + spread),
      dayLow: round2(Math.min(price, previousClose) - spread),
      open: round2(previousClose + (rand(seed + 1) - 0.5) * spread),
      asOf: new Date(),
    };
  }

  async getDailyBars(ticker: string, from: Date, to: Date): Promise<Bar[]> {
    const bars: Bar[] = [];
    const start = dayIndex(from);
    const end = dayIndex(to);

    for (let d = start; d <= end; d++) {
      if (isWeekend(d)) continue;

      const close = closeOn(ticker, d);
      const open = closeOn(ticker, previousSession(d));
      const seed = hashSeed(ticker) ^ d;
      const spread = close * (0.004 + rand(seed) * 0.018);

      bars.push({
        ts: new Date(d * MS_PER_DAY),
        open: round2(open),
        high: round2(Math.max(open, close) + spread),
        low: round2(Math.min(open, close) - spread),
        close: round2(close),
        volume: Math.floor(500_000 + rand(seed + 7) * 40_000_000),
      });
    }
    return bars;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
