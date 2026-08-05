import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SOURCE_WEIGHT,
  LOW_SIGNAL_THRESHOLD,
  classifyEvent,
  materialityScore,
} from "./classify";

describe("classifyEvent", () => {
  it("recognises earnings reports", () => {
    for (const t of [
      "Apple Reports Third Quarter Fiscal Results",
      "Nvidia announces financial results for the fourth quarter",
      "Microsoft beats estimates on cloud strength",
    ]) {
      assert.equal(classifyEvent(t), "earnings", t);
    }
  });

  it("recognises guidance changes", () => {
    assert.equal(classifyEvent("Apple Raises Full-Year Outlook"), "guidance");
    assert.equal(classifyEvent("Ford issues a profit warning"), "guidance");
  });

  it("recognises M&A", () => {
    assert.equal(classifyEvent("Broadcom to acquire VMware"), "ma");
    assert.equal(classifyEvent("Company announces merger with rival"), "ma");
  });

  it("recognises leadership change", () => {
    assert.equal(classifyEvent("Apple Names New Chief Financial Officer"), "leadership");
    assert.equal(classifyEvent("Boeing CEO steps down"), "leadership");
  });

  it("recognises capital returns", () => {
    assert.equal(classifyEvent("Board approves $10bn buyback"), "capital_return");
    assert.equal(classifyEvent("Company declares quarterly dividend"), "capital_return");
  });

  it("recognises legal and regulatory events", () => {
    assert.equal(classifyEvent("FTC opens antitrust probe"), "legal");
    assert.equal(classifyEvent("Company settles class action lawsuit"), "legal");
  });

  it("recognises commercial and product events", () => {
    assert.equal(classifyEvent("Apple Unveils Next Generation Platform"), "product");
    assert.equal(
      classifyEvent("Nvidia Signs Multi-Year Supply Agreement With AAPL"),
      "product",
    );
  });

  it("recognises analyst commentary", () => {
    assert.equal(classifyEvent("Analyst raises AAPL price target"), "analyst");
    assert.equal(classifyEvent("Morgan Stanley downgrades the stock"), "analyst");
  });

  it("catches listicles even when they mention real events", () => {
    // Opinion is tested first on purpose — a listicle about earnings is still
    // a listicle, and this is the highest-volume category in real feeds.
    for (const t of [
      "3 Reasons To Buy Apple Stock Before It Explodes",
      "2 Growth Stocks To Buy Right Now",
      "Should You Buy Nvidia Stock After Earnings?",
      "Here's why Apple stock could double",
      "Better Buy: Apple vs Microsoft",
      "My Top Pick For The Next Decade",
    ]) {
      assert.equal(classifyEvent(t), "opinion", t);
    }
  });

  it("falls back to other", () => {
    assert.equal(classifyEvent("Apple opens a new store in Mumbai"), "other");
  });
});

describe("materialityScore", () => {
  it("ranks a wire earnings release above an aggregator listicle", () => {
    const earnings = materialityScore("earnings", DEFAULT_SOURCE_WEIGHT.wire);
    const listicle = materialityScore("opinion", DEFAULT_SOURCE_WEIGHT.aggregator);
    assert.ok(earnings > listicle, `${earnings} vs ${listicle}`);
  });

  it("keeps a listicle low even from a trusted source", () => {
    // Multiplicative scoring: a trusted outlet does not launder a listicle.
    const score = materialityScore("opinion", DEFAULT_SOURCE_WEIGHT.regulator);
    assert.ok(score < LOW_SIGNAL_THRESHOLD, String(score));
  });

  it("discounts a real event carried by a weak source", () => {
    const wire = materialityScore("earnings", DEFAULT_SOURCE_WEIGHT.wire);
    const aggregator = materialityScore(
      "earnings",
      DEFAULT_SOURCE_WEIGHT.aggregator,
    );
    assert.ok(wire > aggregator);
  });

  it("puts opinion and analyst notes below the collapse threshold", () => {
    for (const kind of ["opinion", "analyst"] as const) {
      const score = materialityScore(kind, DEFAULT_SOURCE_WEIGHT.aggregator);
      assert.ok(score < LOW_SIGNAL_THRESHOLD, `${kind}=${score}`);
    }
  });

  it("keeps material events above the collapse threshold", () => {
    for (const kind of ["earnings", "guidance", "ma", "leadership"] as const) {
      const score = materialityScore(kind, DEFAULT_SOURCE_WEIGHT.wire);
      assert.ok(score >= LOW_SIGNAL_THRESHOLD, `${kind}=${score}`);
    }
  });

  it("stays within 0 and 1", () => {
    assert.ok(materialityScore("earnings", 1) <= 1);
    assert.ok(materialityScore("opinion", 0) >= 0);
  });
});
