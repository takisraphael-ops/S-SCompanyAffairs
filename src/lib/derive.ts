/**
 * Metrics computed rather than stored.
 *
 * Only facts a provider actually asserted go in `fundamentals`. Anything
 * derivable is computed here, at read time, for two reasons:
 *
 *   - market cap and P/E depend on the live price, so a stored copy is stale
 *     the moment it is written;
 *   - a stored margin can silently disagree with the revenue and profit it
 *     was derived from once either is restated, and a number that contradicts
 *     the numbers beside it is worse than no number.
 *
 * Every key produced here is in METRIC_KEYS, so each one has an explanation.
 */

export interface DerivationInputs {
  /** Reported facts for one period, keyed by metric. */
  facts: Map<string, number>;
  /** Latest price, when available. */
  price?: number | null;
}

export interface DerivedMetric {
  metricKey: string;
  value: number;
  unit: "USD" | "percent" | "ratio" | "shares";
}

/** Guard against dividing by a missing, zero, or nonsensical denominator. */
function ratio(numerator: number | undefined, denominator: number | undefined) {
  if (numerator === undefined || denominator === undefined) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function deriveMetrics(input: DerivationInputs): DerivedMetric[] {
  const f = input.facts;
  const out: DerivedMetric[] = [];

  const push = (
    metricKey: string,
    value: number | null,
    unit: DerivedMetric["unit"],
    places = 2,
  ) => {
    if (value === null || !Number.isFinite(value)) return;
    out.push({ metricKey, value: round(value, places), unit });
  };

  const revenue = f.get("revenue");
  const grossProfit = f.get("gross_profit");
  const operatingIncome = f.get("operating_income");
  const netIncome = f.get("net_income");
  const assets = f.get("assets");
  const liabilities = f.get("liabilities");
  const bookValue = f.get("book_value");
  const shares = f.get("shares_outstanding");
  const eps = f.get("eps");
  const ocf = f.get("operating_cash_flow");
  const capex = f.get("capex");

  // --- margins -----------------------------------------------------------
  const grossRatio = ratio(grossProfit, revenue);
  push("gross_margin", grossRatio === null ? null : grossRatio * 100, "percent");

  const operatingRatio = ratio(operatingIncome, revenue);
  push(
    "operating_margin",
    operatingRatio === null ? null : operatingRatio * 100,
    "percent",
  );

  const netRatio = ratio(netIncome, revenue);
  push("net_margin", netRatio === null ? null : netRatio * 100, "percent");

  // --- cash --------------------------------------------------------------
  if (ocf !== undefined && capex !== undefined) {
    // Capex is reported as a positive outflow in XBRL, so it is subtracted
    // regardless of the sign the provider used.
    push("free_cash_flow", ocf - Math.abs(capex), "USD", 0);
  }

  // --- balance sheet -----------------------------------------------------
  push("debt_to_equity", ratio(liabilities, bookValue), "ratio");
  push("current_ratio", ratio(assets, liabilities), "ratio");

  // --- market-derived ----------------------------------------------------
  const price = input.price ?? null;
  if (price !== null && Number.isFinite(price) && shares !== undefined) {
    const marketCap = price * shares;
    push("market_cap", marketCap, "USD", 0);
    push("ps_ratio", ratio(marketCap, revenue), "ratio");
    push("pb_ratio", ratio(marketCap, bookValue), "ratio");
  }

  if (price !== null && Number.isFinite(price) && eps !== undefined && eps > 0) {
    // P/E is meaningless when earnings are zero or negative — the ratio either
    // explodes or goes negative, and neither says anything useful.
    push("pe_ratio", price / eps, "ratio");
  }

  return out;
}

/** Format a value for display given its unit. */
export function formatMetricValue(
  value: number,
  unit: string,
): string {
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "ratio") return value.toFixed(2);
  if (unit === "shares") return compactNumber(value);
  if (unit === "USD/shares") {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    });
  }
  return compactCurrency(value);
}

/** 1_234_567_890 → "1.23B". Long financial figures are unreadable in full. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

export function compactCurrency(value: number): string {
  return `$${compactNumber(value)}`;
}
