import type { PeriodType } from "@/db/schema";

/**
 * Turning SEC XBRL company facts into the narrow rows `fundamentals` stores.
 *
 * Three things make this less mechanical than it looks:
 *
 *  1. Companies use different tags for the same idea. Revenue alone has at
 *     least three common spellings, so each metric carries an ordered list of
 *     candidate tags and the first one that yields data wins.
 *  2. Every filing restates prior periods. The same (period, metric) appears
 *     many times with different `filed` dates, and the most recently filed
 *     value is the correct one.
 *  3. Duration facts (revenue over a quarter) and instant facts (assets on a
 *     date) share a shape but differ in whether `start` is present. Period
 *     length is what separates an annual figure from a quarterly one — `fp`
 *     is not reliable enough on its own.
 */

/** One fact as it appears in a companyfacts unit array. */
export interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

export interface CompanyFacts {
  cik?: number;
  entityName?: string;
  facts?: Record<string, Record<string, { units?: Record<string, XbrlFact[]> }>>;
}

export interface FundamentalFact {
  metricKey: string;
  periodEnd: Date;
  periodType: PeriodType;
  value: number;
  unit: string;
  /** Form the value came from, e.g. "10-K". */
  form: string | null;
  filedAt: Date | null;
}

interface MetricSpec {
  metricKey: string;
  /** Ordered candidates; the first taxonomy tag with data is used. */
  tags: Array<{ taxonomy: string; tag: string }>;
  /** Instant facts have no `start` — balance sheet items. */
  instant: boolean;
  /** Expected unit key inside `units`. */
  unit: string;
}

const usGaap = (tag: string) => ({ taxonomy: "us-gaap", tag });
const dei = (tag: string) => ({ taxonomy: "dei", tag });

/**
 * Metrics we extract, in the order they should be tried.
 *
 * Every `metricKey` here must have a concept mapped to it — that is enforced
 * by `npm run concepts:coverage`, which is what stops a number reaching the
 * UI without an explanation.
 */
export const METRIC_SPECS: MetricSpec[] = [
  {
    metricKey: "revenue",
    tags: [
      usGaap("RevenueFromContractWithCustomerExcludingAssessedTax"),
      usGaap("Revenues"),
      usGaap("SalesRevenueNet"),
      usGaap("RevenueFromContractWithCustomerIncludingAssessedTax"),
    ],
    instant: false,
    unit: "USD",
  },
  {
    metricKey: "gross_profit",
    tags: [usGaap("GrossProfit")],
    instant: false,
    unit: "USD",
  },
  {
    metricKey: "operating_income",
    tags: [usGaap("OperatingIncomeLoss")],
    instant: false,
    unit: "USD",
  },
  {
    metricKey: "net_income",
    tags: [usGaap("NetIncomeLoss"), usGaap("ProfitLoss")],
    instant: false,
    unit: "USD",
  },
  {
    metricKey: "eps",
    tags: [
      usGaap("EarningsPerShareDiluted"),
      usGaap("EarningsPerShareBasic"),
      usGaap("EarningsPerShareBasicAndDiluted"),
    ],
    instant: false,
    unit: "USD/shares",
  },
  {
    metricKey: "operating_cash_flow",
    tags: [
      usGaap("NetCashProvidedByUsedInOperatingActivities"),
      usGaap(
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
      ),
    ],
    instant: false,
    unit: "USD",
  },
  {
    metricKey: "capex",
    tags: [
      usGaap("PaymentsToAcquirePropertyPlantAndEquipment"),
      usGaap("PaymentsToAcquireProductiveAssets"),
    ],
    instant: false,
    unit: "USD",
  },
  {
    metricKey: "assets",
    tags: [usGaap("Assets")],
    instant: true,
    unit: "USD",
  },
  {
    metricKey: "liabilities",
    tags: [usGaap("Liabilities")],
    instant: true,
    unit: "USD",
  },
  {
    metricKey: "book_value",
    tags: [
      usGaap("StockholdersEquity"),
      usGaap(
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      ),
    ],
    instant: true,
    unit: "USD",
  },
  {
    metricKey: "cash",
    tags: [
      usGaap("CashAndCashEquivalentsAtCarryingValue"),
      usGaap("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"),
    ],
    instant: true,
    unit: "USD",
  },
  {
    metricKey: "shares_outstanding",
    tags: [
      dei("EntityCommonStockSharesOutstanding"),
      usGaap("WeightedAverageNumberOfDilutedSharesOutstanding"),
      usGaap("CommonStockSharesOutstanding"),
    ],
    instant: true,
    unit: "shares",
  },
];

const DAY_MS = 86_400_000;

/**
 * Classify a duration fact by how long it actually covers.
 *
 * `fp` says "FY" or "Q3", but 10-K filings also carry quarterly facts and
 * some companies mislabel them. Elapsed days is the honest signal: roughly a
 * year, or roughly a quarter, and anything else (half-years, nine-month
 * cumulatives) is discarded rather than filed under a period it is not.
 */
function classifyDuration(start: string, end: string): PeriodType | null {
  const days = (Date.parse(end) - Date.parse(start)) / DAY_MS;
  if (!Number.isFinite(days)) return null;
  if (days >= 330 && days <= 400) return "annual";
  if (days >= 80 && days <= 100) return "quarterly";
  return null;
}

function parseDate(value: string): Date | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Pick the authoritative fact for each (period end, period type).
 *
 * Later filings restate earlier ones, so the highest `filed` date wins. Where
 * that is absent or tied, an annual figure from a 10-K is preferred to the
 * same period appearing inside a later 10-Q.
 */
function selectLatest(facts: FundamentalFact[]): FundamentalFact[] {
  const best = new Map<string, FundamentalFact>();

  for (const fact of facts) {
    const key = `${fact.periodType}|${fact.periodEnd.toISOString()}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, fact);
      continue;
    }

    const incomingFiled = fact.filedAt?.getTime() ?? 0;
    const existingFiled = existing.filedAt?.getTime() ?? 0;

    if (incomingFiled > existingFiled) {
      best.set(key, fact);
    } else if (incomingFiled === existingFiled) {
      const incomingIsAnnualForm = fact.form === "10-K";
      const existingIsAnnualForm = existing.form === "10-K";
      if (incomingIsAnnualForm && !existingIsAnnualForm) best.set(key, fact);
    }
  }

  return [...best.values()];
}

/**
 * Extract every supported metric from a companyfacts document.
 *
 * Returns at most `maxPeriodsPerMetric` of the most recent periods for each
 * metric and period type — a large company's history runs to decades, and the
 * app only ever shows the recent end of it.
 */
export function extractFundamentals(
  doc: CompanyFacts,
  opts: { maxPeriodsPerMetric?: number } = {},
): FundamentalFact[] {
  const maxPeriods = opts.maxPeriodsPerMetric ?? 12;
  const out: FundamentalFact[] = [];

  for (const spec of METRIC_SPECS) {
    let collected: FundamentalFact[] = [];

    for (const { taxonomy, tag } of spec.tags) {
      const units = doc.facts?.[taxonomy]?.[tag]?.units;
      const rows = units?.[spec.unit];
      if (!rows?.length) continue;

      for (const fact of rows) {
        if (typeof fact.val !== "number" || !Number.isFinite(fact.val)) continue;

        const periodEnd = parseDate(fact.end);
        if (!periodEnd) continue;

        let periodType: PeriodType | null;
        if (spec.instant) {
          // Instant facts carry no start. Tag them by the report they came
          // from so a year-end balance sheet lines up with the annual income
          // statement beside it.
          if (fact.start) continue;
          periodType = fact.form === "10-K" ? "annual" : "quarterly";
        } else {
          if (!fact.start) continue;
          periodType = classifyDuration(fact.start, fact.end);
        }
        if (!periodType) continue;

        collected.push({
          metricKey: spec.metricKey,
          periodEnd,
          periodType,
          value: fact.val,
          unit: spec.unit,
          form: fact.form ?? null,
          filedAt: fact.filed ? parseDate(fact.filed) : null,
        });
      }

      // First tag that produced anything wins; do not mix taxonomies for one
      // metric, since different tags can mean subtly different things.
      if (collected.length > 0) break;
    }

    collected = selectLatest(collected);

    for (const periodType of ["annual", "quarterly"] as const) {
      const subset = collected
        .filter((f) => f.periodType === periodType)
        .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())
        .slice(0, maxPeriods);
      out.push(...subset);
    }
  }

  return out;
}
