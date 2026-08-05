import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactNumber, deriveMetrics, formatMetricValue } from "./derive";

function derive(
  facts: Record<string, number>,
  price?: number | null,
): Map<string, number> {
  const result = deriveMetrics({ facts: new Map(Object.entries(facts)), price });
  return new Map(result.map((m) => [m.metricKey, m.value]));
}

describe("deriveMetrics — margins", () => {
  it("computes the three margins as percentages", () => {
    const out = derive({
      revenue: 1000,
      gross_profit: 400,
      operating_income: 250,
      net_income: 200,
    });
    assert.equal(out.get("gross_margin"), 40);
    assert.equal(out.get("operating_margin"), 25);
    assert.equal(out.get("net_margin"), 20);
  });

  it("handles a loss as a negative margin", () => {
    const out = derive({ revenue: 1000, net_income: -150 });
    assert.equal(out.get("net_margin"), -15);
  });

  it("omits a margin when revenue is missing", () => {
    const out = derive({ gross_profit: 400 });
    assert.equal(out.has("gross_margin"), false);
  });

  it("omits a margin rather than dividing by zero", () => {
    const out = derive({ revenue: 0, gross_profit: 400 });
    assert.equal(out.has("gross_margin"), false);
  });
});

describe("deriveMetrics — cash flow", () => {
  it("subtracts capex from operating cash flow", () => {
    const out = derive({ operating_cash_flow: 1000, capex: 300 });
    assert.equal(out.get("free_cash_flow"), 700);
  });

  it("treats capex as an outflow whichever sign the provider used", () => {
    // XBRL reports it positive; other providers report it negative.
    assert.equal(
      derive({ operating_cash_flow: 1000, capex: -300 }).get("free_cash_flow"),
      700,
    );
  });

  it("omits free cash flow when either input is missing", () => {
    assert.equal(derive({ operating_cash_flow: 1000 }).has("free_cash_flow"), false);
    assert.equal(derive({ capex: 300 }).has("free_cash_flow"), false);
  });
});

describe("deriveMetrics — market-derived", () => {
  it("computes market cap from price and share count", () => {
    const out = derive({ shares_outstanding: 1_000_000 }, 25);
    assert.equal(out.get("market_cap"), 25_000_000);
  });

  it("computes P/E from price and EPS", () => {
    const out = derive({ eps: 8 }, 200);
    assert.equal(out.get("pe_ratio"), 25);
  });

  it("omits P/E when earnings are negative", () => {
    // The ratio goes negative and says nothing useful.
    assert.equal(derive({ eps: -2 }, 200).has("pe_ratio"), false);
  });

  it("omits P/E when earnings are zero", () => {
    assert.equal(derive({ eps: 0 }, 200).has("pe_ratio"), false);
  });

  it("omits every market-derived metric without a price", () => {
    const out = derive({ shares_outstanding: 1_000_000, eps: 8, revenue: 100 }, null);
    for (const key of ["market_cap", "pe_ratio", "ps_ratio", "pb_ratio"]) {
      assert.equal(out.has(key), false, key);
    }
  });

  it("computes price-to-sales and price-to-book from market cap", () => {
    const out = derive(
      { shares_outstanding: 1_000_000, revenue: 5_000_000, book_value: 10_000_000 },
      25,
    );
    assert.equal(out.get("ps_ratio"), 5); // 25m / 5m
    assert.equal(out.get("pb_ratio"), 2.5); // 25m / 10m
  });
});

describe("deriveMetrics — balance sheet ratios", () => {
  it("computes debt-to-equity and current ratio", () => {
    const out = derive({ assets: 3000, liabilities: 1800, book_value: 1200 });
    assert.equal(out.get("debt_to_equity"), 1.5);
    assert.equal(out.get("current_ratio"), 1.67);
  });

  it("omits debt-to-equity when equity is zero", () => {
    assert.equal(
      derive({ liabilities: 1000, book_value: 0 }).has("debt_to_equity"),
      false,
    );
  });
});

describe("deriveMetrics — internal consistency", () => {
  it("produces figures that agree with their inputs", () => {
    const facts = {
      revenue: 383_285_000_000,
      gross_profit: 169_148_000_000,
      net_income: 96_995_000_000,
      shares_outstanding: 15_550_000_000,
      eps: 6.13,
    };
    const out = derive(facts, 190);

    const grossMargin = out.get("gross_margin")!;
    assert.ok(Math.abs(grossMargin - 44.1) < 0.2, String(grossMargin));

    const marketCap = out.get("market_cap")!;
    const psRatio = out.get("ps_ratio")!;
    assert.ok(
      Math.abs(psRatio - marketCap / facts.revenue) < 0.01,
      "P/S must agree with the market cap it came from",
    );
  });

  it("returns nothing when given nothing", () => {
    assert.deepEqual(deriveMetrics({ facts: new Map() }), []);
  });
});

describe("compactNumber", () => {
  it("abbreviates large figures", () => {
    assert.equal(compactNumber(383_285_000_000), "383.29B");
    assert.equal(compactNumber(1_500_000), "1.50M");
    assert.equal(compactNumber(2_400_000_000_000), "2.40T");
  });

  it("keeps the sign", () => {
    assert.equal(compactNumber(-1_500_000), "-1.50M");
  });

  it("leaves small numbers alone", () => {
    assert.equal(compactNumber(42), "42.00");
  });
});

describe("formatMetricValue", () => {
  it("formats by unit", () => {
    assert.equal(formatMetricValue(44.1, "percent"), "44.1%");
    assert.equal(formatMetricValue(25.4, "ratio"), "25.40");
    assert.equal(formatMetricValue(1_000_000_000, "USD"), "$1.00B");
    assert.equal(formatMetricValue(15_550_000_000, "shares"), "15.55B");
    assert.equal(formatMetricValue(6.13, "USD/shares"), "$6.13");
  });
});
