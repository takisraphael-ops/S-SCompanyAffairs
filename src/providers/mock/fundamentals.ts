import type {
  CalendarProvider,
  CompanyEventDatum,
  FundamentalDatum,
  FundamentalsProvider,
  NewsTarget,
} from "../types";

/**
 * Deterministic fake financials, so the company page is usable with no keys.
 *
 * The figures are internally consistent — gross profit is below revenue,
 * operating income below that, and the balance sheet balances — because the
 * derived metrics computed on top (margins, P/E) would otherwise produce
 * nonsense that looks like a bug in the derivation rather than in the fixture.
 */

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Fiscal year end: 31 December of `year`, at UTC midnight. */
function yearEnd(year: number): Date {
  return new Date(Date.UTC(year, 11, 31));
}

function quarterEnd(year: number, quarter: number): Date {
  return new Date(Date.UTC(year, quarter * 3, 0));
}

interface Shape {
  revenue: number;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
  shares: number;
}

function shapeFor(ticker: string): Shape {
  const seed = hashSeed(ticker);
  return {
    revenue: 8_000_000_000 + rand(seed) * 300_000_000_000,
    grossMargin: 0.28 + rand(seed + 1) * 0.5,
    operatingMargin: 0.08 + rand(seed + 2) * 0.28,
    netMargin: 0.05 + rand(seed + 3) * 0.22,
    shares: 400_000_000 + rand(seed + 4) * 12_000_000_000,
  };
}

function factsForPeriod(
  shape: Shape,
  scale: number,
  periodEnd: Date,
  periodType: "annual" | "quarterly",
  growth: number,
  filedAt: Date,
): FundamentalDatum[] {
  const source = periodType === "annual" ? "mock:10-K" : "mock:10-Q";
  const revenue = shape.revenue * scale * growth;
  const grossProfit = revenue * shape.grossMargin;
  const operatingIncome = revenue * shape.operatingMargin;
  const netIncome = revenue * shape.netMargin;
  const assets = revenue * 1.8;
  const liabilities = assets * 0.55;

  const round = (n: number) => Math.round(n);

  const values: Array<[string, number, string]> = [
    ["revenue", round(revenue), "USD"],
    ["gross_profit", round(grossProfit), "USD"],
    ["operating_income", round(operatingIncome), "USD"],
    ["net_income", round(netIncome), "USD"],
    ["eps", Math.round((netIncome / shape.shares) * 100) / 100, "USD/shares"],
    ["operating_cash_flow", round(netIncome * 1.25), "USD"],
    ["capex", round(revenue * 0.06), "USD"],
    ["assets", round(assets), "USD"],
    ["liabilities", round(liabilities), "USD"],
    ["book_value", round(assets - liabilities), "USD"],
    ["cash", round(revenue * 0.22), "USD"],
    ["shares_outstanding", round(shape.shares), "shares"],
  ];

  return values.map(([metricKey, value, unit]) => ({
    metricKey,
    periodEnd,
    periodType,
    value,
    unit,
    filedAt,
    source,
  }));
}

export class MockFundamentalsProvider
  implements FundamentalsProvider, CalendarProvider
{
  readonly name = "mock-fundamentals";

  async getFundamentals(target: NewsTarget): Promise<FundamentalDatum[]> {
    const shape = shapeFor(target.ticker);
    const thisYear = new Date().getUTCFullYear();
    const out: FundamentalDatum[] = [];

    // Four annual periods, growing modestly so trends are visible.
    for (let i = 0; i < 4; i++) {
      const year = thisYear - 1 - i;
      out.push(
        ...factsForPeriod(
          shape,
          1,
          yearEnd(year),
          "annual",
          Math.pow(1.09, -i),
          new Date(Date.UTC(year + 1, 1, 1)),
        ),
      );
    }

    // Four recent quarters at roughly a quarter of annual scale.
    for (let q = 0; q < 4; q++) {
      const quarter = 4 - q;
      const year = quarter === 4 ? thisYear - 1 : thisYear;
      out.push(
        ...factsForPeriod(
          shape,
          0.25,
          quarterEnd(year, quarter),
          "quarterly",
          Math.pow(1.02, -q),
          new Date(quarterEnd(year, quarter).getTime() + 30 * 86_400_000),
        ),
      );
    }

    return out;
  }

  async getEvents(
    target: NewsTarget,
    from: Date,
    to: Date,
  ): Promise<CompanyEventDatum[]> {
    const seed = hashSeed(target.ticker);
    const shape = shapeFor(target.ticker);
    const out: CompanyEventDatum[] = [];

    // Next earnings date, deterministic but spread across companies.
    const daysAhead = 5 + (seed % 45);
    const next = new Date(Date.now() + daysAhead * 86_400_000);
    out.push({
      kind: "earnings",
      scheduledAt: next,
      payload: {
        epsEstimate:
          Math.round(((shape.revenue * shape.netMargin) / shape.shares / 4) * 100) /
          100,
        session: seed % 2 === 0 ? "after market close" : "before market open",
      },
      source: "mock",
    });

    out.push({
      kind: "dividend",
      scheduledAt: new Date(Date.now() + ((seed % 30) + 10) * 86_400_000),
      payload: { amount: Math.round(rand(seed) * 120) / 100, type: "ex-dividend" },
      source: "mock",
    });

    return out.filter((e) => e.scheduledAt >= from && e.scheduledAt <= to);
  }
}
