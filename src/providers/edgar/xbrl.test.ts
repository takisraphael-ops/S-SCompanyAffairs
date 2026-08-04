import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractFundamentals, type CompanyFacts } from "./xbrl";

/**
 * Fixtures mirror the real companyfacts shape. sec.gov is not contacted here,
 * so this is what stands behind the extraction's correctness.
 */

function facts(
  taxonomy: string,
  tag: string,
  unit: string,
  rows: unknown[],
): CompanyFacts {
  return { facts: { [taxonomy]: { [tag]: { units: { [unit]: rows } } } } } as CompanyFacts;
}

const annual = (
  start: string,
  end: string,
  val: number,
  extra: Record<string, unknown> = {},
) => ({ start, end, val, form: "10-K", filed: "2024-02-01", ...extra });

describe("extractFundamentals — period classification", () => {
  it("classifies a roughly year-long duration as annual", () => {
    const doc = facts("us-gaap", "Revenues", "USD", [
      annual("2023-01-01", "2023-12-31", 1000),
    ]);
    const out = extractFundamentals(doc);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.periodType, "annual");
    assert.equal(out[0]?.value, 1000);
  });

  it("classifies a roughly quarter-long duration as quarterly", () => {
    const doc = facts("us-gaap", "Revenues", "USD", [
      { start: "2024-01-01", end: "2024-03-31", val: 250, form: "10-Q", filed: "2024-04-20" },
    ]);
    const out = extractFundamentals(doc);
    assert.equal(out[0]?.periodType, "quarterly");
  });

  it("discards cumulative periods that are neither", () => {
    // Nine-month cumulatives appear in Q3 filings and would otherwise be
    // stored as if they were a quarter or a year.
    const doc = facts("us-gaap", "Revenues", "USD", [
      { start: "2024-01-01", end: "2024-09-30", val: 750, form: "10-Q", filed: "2024-10-20" },
    ]);
    assert.deepEqual(extractFundamentals(doc), []);
  });

  it("does not classify by fp alone", () => {
    // A 10-K carries quarterly facts too; elapsed days is the honest signal.
    const doc = facts("us-gaap", "Revenues", "USD", [
      { start: "2023-10-01", end: "2023-12-31", val: 300, fp: "FY", form: "10-K", filed: "2024-02-01" },
    ]);
    assert.equal(extractFundamentals(doc)[0]?.periodType, "quarterly");
  });
});

describe("extractFundamentals — instant facts", () => {
  it("reads balance-sheet facts that have no start date", () => {
    const doc = facts("us-gaap", "Assets", "USD", [
      { end: "2023-12-31", val: 5000, form: "10-K", filed: "2024-02-01" },
    ]);
    const out = extractFundamentals(doc);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.metricKey, "assets");
    assert.equal(out[0]?.periodType, "annual", "10-K instants align with the annual period");
  });

  it("tags an instant from a 10-Q as quarterly", () => {
    const doc = facts("us-gaap", "Assets", "USD", [
      { end: "2024-03-31", val: 5200, form: "10-Q", filed: "2024-04-20" },
    ]);
    assert.equal(extractFundamentals(doc)[0]?.periodType, "quarterly");
  });

  it("ignores duration facts for an instant metric", () => {
    const doc = facts("us-gaap", "Assets", "USD", [
      { start: "2023-01-01", end: "2023-12-31", val: 5000, form: "10-K", filed: "2024-02-01" },
    ]);
    assert.deepEqual(extractFundamentals(doc), []);
  });
});

describe("extractFundamentals — restatements", () => {
  it("keeps the most recently filed value for a period", () => {
    const doc = facts("us-gaap", "Revenues", "USD", [
      { start: "2023-01-01", end: "2023-12-31", val: 1000, form: "10-K", filed: "2024-02-01" },
      { start: "2023-01-01", end: "2023-12-31", val: 1100, form: "10-K", filed: "2025-02-01" },
    ]);
    const out = extractFundamentals(doc);
    assert.equal(out.length, 1, "one row per period");
    assert.equal(out[0]?.value, 1100, "the restated figure wins");
  });

  it("prefers the annual form when filing dates tie", () => {
    const doc = facts("us-gaap", "Revenues", "USD", [
      { start: "2023-01-01", end: "2023-12-31", val: 900, form: "10-Q", filed: "2024-02-01" },
      { start: "2023-01-01", end: "2023-12-31", val: 1000, form: "10-K", filed: "2024-02-01" },
    ]);
    assert.equal(extractFundamentals(doc)[0]?.value, 1000);
  });

  it("keeps different periods separate", () => {
    const doc = facts("us-gaap", "Revenues", "USD", [
      annual("2022-01-01", "2022-12-31", 900),
      annual("2023-01-01", "2023-12-31", 1000),
    ]);
    assert.equal(extractFundamentals(doc).length, 2);
  });
});

describe("extractFundamentals — tag fallbacks", () => {
  it("falls back to an alternative tag when the preferred one is absent", () => {
    // Companies spell revenue at least three ways.
    const doc = facts("us-gaap", "SalesRevenueNet", "USD", [
      annual("2023-01-01", "2023-12-31", 1000),
    ]);
    const out = extractFundamentals(doc);
    assert.equal(out[0]?.metricKey, "revenue");
  });

  it("prefers the first tag that has data", () => {
    const doc: CompanyFacts = {
      facts: {
        "us-gaap": {
          RevenueFromContractWithCustomerExcludingAssessedTax: {
            units: { USD: [annual("2023-01-01", "2023-12-31", 1000)] },
          },
          Revenues: { units: { USD: [annual("2023-01-01", "2023-12-31", 42)] } },
        },
      },
    } as CompanyFacts;

    const revenue = extractFundamentals(doc).filter((f) => f.metricKey === "revenue");
    assert.equal(revenue.length, 1, "tags are not mixed for one metric");
    assert.equal(revenue[0]?.value, 1000);
  });

  it("reads shares outstanding from the dei taxonomy", () => {
    const doc = facts("dei", "EntityCommonStockSharesOutstanding", "shares", [
      { end: "2024-01-15", val: 15_000_000_000, form: "10-K", filed: "2024-02-01" },
    ]);
    const out = extractFundamentals(doc);
    assert.equal(out[0]?.metricKey, "shares_outstanding");
    assert.equal(out[0]?.unit, "shares");
  });

  it("reads EPS from its per-share unit", () => {
    const doc = facts("us-gaap", "EarningsPerShareDiluted", "USD/shares", [
      annual("2023-01-01", "2023-12-31", 6.13),
    ]);
    const out = extractFundamentals(doc);
    assert.equal(out[0]?.metricKey, "eps");
    assert.equal(out[0]?.value, 6.13);
  });
});

describe("extractFundamentals — robustness", () => {
  it("returns nothing for an empty document", () => {
    assert.deepEqual(extractFundamentals({}), []);
  });

  it("ignores tags it does not know", () => {
    const doc = facts("us-gaap", "SomeUnmappedConcept", "USD", [
      annual("2023-01-01", "2023-12-31", 1000),
    ]);
    assert.deepEqual(extractFundamentals(doc), []);
  });

  it("skips non-numeric and non-finite values", () => {
    const doc = facts("us-gaap", "Revenues", "USD", [
      { start: "2023-01-01", end: "2023-12-31", val: "1000" },
      { start: "2022-01-01", end: "2022-12-31", val: Number.NaN },
    ]);
    assert.deepEqual(extractFundamentals(doc), []);
  });

  it("skips facts with an unparseable date", () => {
    const doc = facts("us-gaap", "Revenues", "USD", [
      { start: "2023-01-01", end: "not-a-date", val: 1000 },
    ]);
    assert.deepEqual(extractFundamentals(doc), []);
  });

  it("caps how many periods it keeps per metric", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      annual(`${1994 + i}-01-01`, `${1994 + i}-12-31`, 100 + i),
    );
    const out = extractFundamentals(facts("us-gaap", "Revenues", "USD", rows), {
      maxPeriodsPerMetric: 5,
    });
    assert.equal(out.length, 5);
    // Most recent kept, oldest dropped.
    assert.equal(out[0]?.periodEnd.getUTCFullYear(), 2023);
  });
});
