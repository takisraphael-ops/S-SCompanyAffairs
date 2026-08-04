/**
 * Canonical keys for every number the app can display.
 *
 * A key here is a promise that the value is explainable: `concept_metrics`
 * maps each one to the concept that defines it, and
 * `npm run concepts:coverage` fails when a key has no explanation. Adding a
 * metric to the UI therefore forces someone to write the explanation, which
 * is what keeps coverage from rotting as the app grows.
 *
 * Keys are snake_case and match the `metric_key` column.
 */
export const METRIC_KEYS = [
  // Rendered today (P0 quotes).
  "price",
  "previous_close",
  "change",
  "change_pct",
  "day_high",
  "day_low",
  "volume",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** Metric keys used by later phases; concepts may map them ahead of use. */
export const PLANNED_METRIC_KEYS = [
  "market_cap",
  "eps",
  "pe_ratio",
  "ps_ratio",
  "pb_ratio",
  "revenue",
  "gross_profit",
  "gross_margin",
  "operating_income",
  "operating_margin",
  "net_income",
  "net_margin",
  "book_value",
  "cash",
  "current_ratio",
  "debt_to_equity",
  "operating_cash_flow",
  "capex",
  "free_cash_flow",
  "dividend",
  "dividend_yield",
  "payout_ratio",
] as const;
