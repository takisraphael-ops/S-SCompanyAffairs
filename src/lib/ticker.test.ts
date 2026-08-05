import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidTicker, normalizeTicker } from "./ticker";

describe("normalizeTicker", () => {
  it("uppercases and trims", () => {
    assert.equal(normalizeTicker("  aapl "), "AAPL");
  });
});

describe("isValidTicker", () => {
  it("accepts ordinary symbols", () => {
    for (const t of ["A", "AAPL", "MSFT", "GOOGL", "nvda"]) {
      assert.ok(isValidTicker(t), t);
    }
  });

  it("accepts share-class suffixes in both conventions", () => {
    for (const t of ["BRK.B", "BRK-B", "RDS.A"]) {
      assert.ok(isValidTicker(t), t);
    }
  });

  it("rejects empty and whitespace input", () => {
    for (const t of ["", "   "]) {
      assert.equal(isValidTicker(t), false, JSON.stringify(t));
    }
  });

  it("rejects symbols with unsafe characters", () => {
    for (const t of [
      "AAPL; DROP TABLE securities",
      "AA PL",
      "<script>",
      "AAPL'",
      "../etc/passwd",
    ]) {
      assert.equal(isValidTicker(t), false, t);
    }
  });

  it("rejects over-long input", () => {
    assert.equal(isValidTicker("ABCDEFGHIJK"), false);
  });
});
