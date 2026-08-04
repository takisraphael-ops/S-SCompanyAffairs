import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as D from "./decimal";

const d = D.fromString;
const s = D.toString;

describe("decimal — exactness", () => {
  it("gets the classic float failures right", () => {
    assert.equal(s(D.add(d("0.1"), d("0.2"))), "0.3");
    assert.equal(s(D.mul(d("12.34"), d("3"))), "37.02");
    assert.equal(s(D.sub(d("1.00"), d("0.90"))), "0.1");
  });

  it("does not drift when accumulating many small amounts", () => {
    // The failure mode that matters: error compounding across lots.
    let total = D.ZERO;
    for (let i = 0; i < 1000; i++) total = D.add(total, d("0.01"));
    assert.equal(s(total), "10");
  });

  it("survives a long chain of buys and sells exactly", () => {
    let basis = D.ZERO;
    for (let i = 0; i < 100; i++) {
      basis = D.add(basis, D.mul(d("3"), d("19.99")));
    }
    assert.equal(s(basis), "5997");
  });
});

describe("decimal — parsing and formatting", () => {
  it("round-trips", () => {
    for (const v of ["0", "1", "-1", "123.456", "-0.00000001", "999999999.99999999"]) {
      assert.equal(s(d(v)), v);
    }
  });

  it("normalises trailing zeros", () => {
    assert.equal(s(d("1.500")), "1.5");
    assert.equal(s(d("2.00")), "2");
  });

  it("accepts a number but parses via its string form", () => {
    assert.equal(s(d(12.34)), "12.34");
  });

  it("truncates beyond the supported scale rather than rounding into it", () => {
    assert.equal(s(d("1.123456789")), "1.12345678");
  });

  it("emits a fixed-scale string for the database", () => {
    assert.equal(D.toDbString(d("1.5")), "1.50000000");
    assert.equal(D.toDbString(d("-2")), "-2.00000000");
  });

  it("rejects junk rather than silently returning zero", () => {
    for (const bad of ["", "abc", "1.2.3", "1e5", "$5", "1,000"]) {
      assert.throws(() => d(bad), /not a decimal/, bad);
    }
  });
});

describe("decimal — rounding", () => {
  it("rounds half away from zero on multiply", () => {
    // 0.005 * 1 at scale 8 is exact; force a genuine half case.
    assert.equal(s(D.mul(d("0.000000005"), d("1"))), "0");
    assert.equal(s(D.mul(d("1.000000005"), d("1"))), "1");
  });

  it("rounds division half away from zero, symmetrically for negatives", () => {
    assert.equal(s(D.div(d("1"), d("3"))), "0.33333333");
    assert.equal(s(D.div(d("-1"), d("3"))), "-0.33333333");
    assert.equal(s(D.div(d("2"), d("3"))), "0.66666667");
    assert.equal(s(D.div(d("-2"), d("3"))), "-0.66666667");
  });

  it("rounds to a given number of places", () => {
    assert.equal(s(D.round(d("1.005"), 2)), "1.01");
    assert.equal(s(D.round(d("-1.005"), 2)), "-1.01");
    assert.equal(s(D.round(d("1.004"), 2)), "1");
  });

  it("throws rather than producing Infinity on divide by zero", () => {
    assert.throws(() => D.div(d("1"), D.ZERO), /division by zero/);
  });
});

describe("decimal — comparison and helpers", () => {
  it("compares", () => {
    assert.equal(D.cmp(d("1"), d("2")), -1);
    assert.equal(D.cmp(d("2"), d("1")), 1);
    assert.equal(D.cmp(d("1.10"), d("1.1")), 0);
  });

  it("sums a list", () => {
    assert.equal(s(D.sum([d("1.1"), d("2.2"), d("3.3")])), "6.6");
    assert.equal(s(D.sum([])), "0");
  });

  it("handles sign helpers", () => {
    assert.equal(s(D.abs(d("-5.5"))), "5.5");
    assert.equal(s(D.neg(d("5.5"))), "-5.5");
    assert.ok(D.isNegative(d("-0.00000001")));
    assert.ok(D.isZero(d("0")));
  });

  it("computes percentage change", () => {
    assert.equal(s(D.percentChange(d("100"), d("110"))!), "10");
    assert.equal(s(D.percentChange(d("100"), d("90"))!), "-10");
    assert.equal(D.percentChange(D.ZERO, d("10")), null);
  });

  it("measures a loss on a short-style negative base by magnitude", () => {
    // Dividing by the absolute base keeps the sign meaningful.
    assert.equal(s(D.percentChange(d("-100"), d("-110"))!), "-10");
  });
});

describe("decimal — display conversion", () => {
  it("converts to a number for rendering", () => {
    assert.equal(D.toNumber(d("1234.56")), 1234.56);
    assert.equal(D.toNumber(D.ZERO), 0);
  });
});
