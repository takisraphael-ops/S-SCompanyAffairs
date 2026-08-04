import { z } from "zod";
import { fetchJson } from "../http";
import { RateLimiter } from "../rate-limit";
import type {
  CompanyProfile,
  Filing,
  FilingsProvider,
  ProfileProvider,
} from "../types";

const PROVIDER = "edgar";
const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";

/** SEC asks for no more than 10 requests/second. Stay comfortably under. */
const limiter = new RateLimiter(5, 5);

const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1000;

/** Keyed by row index, hence the record rather than an array. */
const tickerMapSchema = z.record(
  z.string(),
  z.object({
    cik_str: z.number(),
    ticker: z.string(),
    title: z.string(),
  }),
);

/**
 * Filings arrive column-wise: parallel arrays that must be zipped by index,
 * not an array of objects.
 */
const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  tickers: z.array(z.string()).optional(),
  exchanges: z.array(z.string()).optional(),
  sicDescription: z.string().optional(),
  filings: z
    .object({
      recent: z
        .object({
          accessionNumber: z.array(z.string()).optional(),
          form: z.array(z.string()).optional(),
          filingDate: z.array(z.string()).optional(),
          primaryDocument: z.array(z.string()).optional(),
          primaryDocDescription: z.array(z.string().nullable()).optional(),
        })
        .optional(),
    })
    .optional(),
});

type TickerMap = Map<string, { cik: string; title: string }>;

let tickerMapCache: { map: TickerMap; loadedAt: number } | null = null;
let tickerMapInFlight: Promise<TickerMap> | null = null;

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

export class EdgarProvider implements FilingsProvider, ProfileProvider {
  readonly name = PROVIDER;

  constructor(private readonly userAgent: string) {}

  private get headers() {
    return {
      // SEC returns 403 without a declarative User-Agent identifying the operator.
      "user-agent": this.userAgent,
      "accept-encoding": "gzip, deflate",
    };
  }

  private async tickerMap(): Promise<TickerMap> {
    const fresh =
      tickerMapCache && Date.now() - tickerMapCache.loadedAt < TICKER_MAP_TTL_MS;
    if (fresh && tickerMapCache) return tickerMapCache.map;

    // Single-flight: the file is ~1MB and several watchlist adds can race.
    if (tickerMapInFlight) return tickerMapInFlight;

    tickerMapInFlight = (async () => {
      try {
        const raw = await fetchJson(TICKER_MAP_URL, {
          provider: PROVIDER,
          schema: tickerMapSchema,
          headers: this.headers,
          limiter,
          timeoutMs: 30_000,
        });

        const map: TickerMap = new Map();
        for (const row of Object.values(raw)) {
          map.set(row.ticker.toUpperCase(), {
            cik: padCik(row.cik_str),
            title: row.title,
          });
        }
        tickerMapCache = { map, loadedAt: Date.now() };
        return map;
      } finally {
        tickerMapInFlight = null;
      }
    })();

    return tickerMapInFlight;
  }

  async resolveCik(ticker: string): Promise<string | null> {
    const map = await this.tickerMap();
    return map.get(ticker.toUpperCase())?.cik ?? null;
  }

  /**
   * Company metadata straight from SEC submissions. This is what lets the app
   * resolve a real company name with no API key configured at all.
   */
  async getProfile(ticker: string): Promise<CompanyProfile | null> {
    const cik = await this.resolveCik(ticker);
    if (!cik) return null;

    const raw = await this.submissions(cik);
    return {
      ticker: ticker.toUpperCase(),
      name: raw.name ?? ticker.toUpperCase(),
      exchange: raw.exchanges?.[0] ?? null,
      cik,
      sector: null,
      industry: raw.sicDescription ?? null,
    };
  }

  private async submissions(cik: string) {
    return fetchJson(`${SUBMISSIONS_BASE}/CIK${padCik(cik)}.json`, {
      provider: PROVIDER,
      schema: submissionsSchema,
      headers: this.headers,
      limiter,
      timeoutMs: 20_000,
    });
  }

  async getRecentFilings(cik: string, limit = 20): Promise<Filing[]> {
    const raw = await this.submissions(cik);
    const recent = raw.filings?.recent;
    if (!recent?.accessionNumber || !recent.form || !recent.filingDate) {
      return [];
    }

    const padded = padCik(cik);
    const cikNumeric = String(Number(padded)); // Archives paths drop the padding.
    const out: Filing[] = [];

    const count = Math.min(recent.accessionNumber.length, limit);
    for (let i = 0; i < count; i++) {
      const accession = recent.accessionNumber[i];
      const form = recent.form[i];
      const filedAt = recent.filingDate[i];
      if (!accession || !form || !filedAt) continue;

      const doc = recent.primaryDocument?.[i];
      const bare = accession.replace(/-/g, "");
      const url = doc
        ? `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${bare}/${doc}`
        : `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${bare}/`;

      out.push({
        cik: padded,
        accessionNo: accession,
        formType: form,
        filedAt: new Date(`${filedAt}T00:00:00Z`),
        url,
        description: recent.primaryDocDescription?.[i] ?? null,
      });
    }
    return out;
  }
}

/** Test seam: drop the cached ticker map. */
export function resetEdgarCache(): void {
  tickerMapCache = null;
  tickerMapInFlight = null;
}
