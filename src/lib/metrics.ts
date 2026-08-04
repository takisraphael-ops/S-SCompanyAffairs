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
  // Quotes (P0).
  "price",
  "previous_close",
  "change",
  "change_pct",
  "day_high",
  "day_low",
  "volume",

  // Reported fundamentals (P3), extracted from SEC XBRL.
  "revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "eps",
  "operating_cash_flow",
  "capex",
  "assets",
  "liabilities",
  "book_value",
  "cash",
  "shares_outstanding",

  // Derived at read time from the above plus the live price (src/lib/derive.ts).
  "gross_margin",
  "operating_margin",
  "net_margin",
  "free_cash_flow",
  "debt_to_equity",
  "current_ratio",
  "market_cap",
  "pe_ratio",
  "ps_ratio",
  "pb_ratio",

  // Portfolio (P4), computed by the ledger engine from the transaction log.
  "quantity",
  "cost_basis",
  "market_value",
  "unrealized_gain",
  "realized_gain",
  "dividend_income",
  "total_return",
  "position_weight",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** Metric keys used by later phases; concepts may map them ahead of use. */
export const PLANNED_METRIC_KEYS = [
  "dividend",
  "dividend_yield",
  "payout_ratio",
] as const;

/**
 * Display order and grouping for the company page.
 *
 * Grouped the way the statements themselves are, so someone learning can see
 * that gross profit sits under revenue and margins are derived from both.
 */
export const METRIC_GROUPS: Array<{ title: string; keys: string[] }> = [
  {
    title: "Size and valuation",
    keys: ["market_cap", "pe_ratio", "ps_ratio", "pb_ratio", "shares_outstanding"],
  },
  {
    title: "Income statement",
    keys: [
      "revenue",
      "gross_profit",
      "gross_margin",
      "operating_income",
      "operating_margin",
      "net_income",
      "net_margin",
      "eps",
    ],
  },
  {
    title: "Cash flow",
    keys: ["operating_cash_flow", "capex", "free_cash_flow"],
  },
  {
    title: "Balance sheet",
    keys: [
      "assets",
      "liabilities",
      "book_value",
      "cash",
      "current_ratio",
      "debt_to_equity",
    ],
  },
];
