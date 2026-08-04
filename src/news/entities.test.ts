import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveEntities,
  stripCorporateSuffix,
  type EntityCandidate,
} from "./entities";

const APPLE: EntityCandidate = {
  securityId: "sec-apple",
  ticker: "AAPL",
  name: "Apple Inc.",
  aliases: [],
};
const AMD: EntityCandidate = {
  securityId: "sec-amd",
  ticker: "AMD",
  name: "Advanced Micro Devices, Inc.",
  aliases: [],
};
const TARGET: EntityCandidate = {
  securityId: "sec-target",
  ticker: "TGT",
  name: "Target Corporation",
  aliases: [],
};
const GO: EntityCandidate = {
  securityId: "sec-go",
  ticker: "GO",
  name: "Grocery Outlet Holding Corp",
  aliases: [],
};

const ALL = [APPLE, AMD, TARGET, GO];

function match(title: string, snippet?: string) {
  return resolveEntities({ title, snippet }, ALL);
}

function tickersFor(title: string): string[] {
  return match(title)
    .map((m) => ALL.find((c) => c.securityId === m.securityId)!.ticker)
    .sort();
}

describe("stripCorporateSuffix", () => {
  it("removes legal suffixes", () => {
    assert.equal(stripCorporateSuffix("Apple Inc."), "Apple");
    assert.equal(stripCorporateSuffix("Target Corporation"), "Target");
    assert.equal(
      stripCorporateSuffix("Advanced Micro Devices, Inc."),
      "Advanced Micro Devices",
    );
  });

  it("leaves a name with no suffix alone", () => {
    assert.equal(stripCorporateSuffix("Nvidia"), "Nvidia");
  });
});

describe("resolveEntities — the ambiguity problem", () => {
  it("does not match a company on a bare common word", () => {
    // The failure this whole module exists to prevent.
    assert.deepEqual(tickersFor("Apple picking season begins in Vermont"), []);
    assert.deepEqual(tickersFor("Target practice draws complaints"), []);
  });

  it("matches a common-word name when a legal suffix follows it", () => {
    assert.deepEqual(tickersFor("Apple Inc. announces buyback"), ["AAPL"]);
  });

  it("matches a common-word name when the ticker corroborates it", () => {
    assert.deepEqual(
      tickersFor("Apple ($AAPL) announces a new product line"),
      ["AAPL"],
    );
  });

  it("matches a distinctive multi-word name without corroboration", () => {
    assert.deepEqual(
      tickersFor("Advanced Micro Devices wins a data centre contract"),
      ["AMD"],
    );
  });

  it("ignores one and two letter tickers without a cashtag", () => {
    // "GO" appears in ordinary prose constantly.
    assert.deepEqual(tickersFor("Regulators say the deal can go ahead"), []);
  });

  it("still matches a short ticker written as a cashtag", () => {
    assert.deepEqual(tickersFor("$GO reports quarterly results"), ["GO"]);
  });

  it("does not match a lowercase ticker in ordinary prose", () => {
    assert.deepEqual(tickersFor("the amd of tomorrow"), []);
  });

  it("ignores tickers that are common abbreviations", () => {
    assert.deepEqual(tickersFor("ALL of the results were strong"), []);
  });
});

describe("resolveEntities — provenance and scoring", () => {
  it("attributes to the feed it was fetched from without needing text", () => {
    const matches = resolveEntities(
      { title: "Quarterly update published" },
      ALL,
      { fetchedForSecurityId: "sec-apple" },
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.method, "feed_query");
    assert.equal(matches[0]?.relevance, 0.95);
  });

  it("uses a provider's own ticker tags", () => {
    const matches = resolveEntities({ title: "Untagged headline" }, ALL, {
      providerTickers: ["AMD"],
    });
    assert.equal(matches[0]?.method, "provider_tag");
  });

  it("keeps the highest-scoring method per security", () => {
    const matches = resolveEntities(
      { title: "Apple Inc. and $AAPL both appear" },
      [APPLE],
      { fetchedForSecurityId: "sec-apple" },
    );
    assert.equal(matches.length, 1, "one link per security");
    assert.equal(matches[0]?.method, "feed_query", "0.95 beats 0.9 and 0.85");
  });

  it("links a cross-mention as well as the fetched company", () => {
    // The many-to-many case: one article, genuinely about two companies.
    const matches = resolveEntities(
      { title: "Apple Inc. signs supply agreement with $AMD" },
      ALL,
      { fetchedForSecurityId: "sec-apple" },
    );
    const byTicker = Object.fromEntries(
      matches.map((m) => [
        ALL.find((c) => c.securityId === m.securityId)!.ticker,
        m.method,
      ]),
    );
    assert.deepEqual(byTicker, { AAPL: "feed_query", AMD: "ticker" });
  });

  it("returns matches strongest first", () => {
    const matches = resolveEntities(
      { title: "Advanced Micro Devices and $AAPL partner" },
      ALL,
      { fetchedForSecurityId: "sec-apple" },
    );
    for (let i = 1; i < matches.length; i++) {
      assert.ok(
        matches[i - 1]!.relevance >= matches[i]!.relevance,
        "descending relevance",
      );
    }
  });

  it("matches a curated alias", () => {
    const withAlias: EntityCandidate = {
      ...APPLE,
      aliases: ["iPhone maker"],
    };
    const matches = resolveEntities(
      { title: "iPhone maker expands manufacturing" },
      [withAlias],
    );
    assert.equal(matches[0]?.method, "alias");
  });

  it("searches the snippet as well as the title", () => {
    const matches = resolveEntities(
      { title: "Chipmaker wins contract", snippet: "The deal involves $AMD." },
      ALL,
    );
    assert.equal(matches[0]?.method, "ticker");
  });
});
