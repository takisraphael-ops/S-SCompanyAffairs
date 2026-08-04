import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromHex, hammingDistance, simhash, toHex } from "./simhash";
import { jaccard, normalizeTitle, tokenize } from "./text";

const tok = (s: string) => tokenize(normalizeTitle(s));

describe("simhash", () => {
  it("is deterministic", () => {
    assert.equal(simhash(tok("Apple reports results")), simhash(tok("Apple reports results")));
  });

  it("ignores token order", () => {
    // Bag-of-words by construction; worth pinning so the limitation is explicit.
    assert.equal(simhash(["alpha", "beta"]), simhash(["beta", "alpha"]));
  });

  it("puts near-identical text within a small distance", () => {
    const a = simhash(tok("Apple Reports Third Quarter Fiscal Results"));
    const b = simhash(tok("Apple Reports Third Quarter Fiscal Results Today"));
    assert.ok(hammingDistance(a, b) <= 12, String(hammingDistance(a, b)));
  });

  it("puts unrelated text far apart", () => {
    const a = simhash(tok("Apple Reports Third Quarter Fiscal Results"));
    const b = simhash(tok("Regulators open antitrust probe into airlines"));
    assert.ok(hammingDistance(a, b) > 12, String(hammingDistance(a, b)));
  });

  it("returns zero for no tokens", () => {
    assert.equal(simhash([]), 0n);
  });
});

describe("hammingDistance", () => {
  it("is zero for identical values", () => {
    assert.equal(hammingDistance(123n, 123n), 0);
  });

  it("counts differing bits", () => {
    assert.equal(hammingDistance(0b1010n, 0b0000n), 2);
    assert.equal(hammingDistance(0n, 0xffffffffffffffffn), 64);
  });
});

describe("hex round-trip", () => {
  it("pads to a fixed width so values sort as text", () => {
    assert.equal(toHex(1n).length, 16);
    assert.equal(toHex(1n), "0000000000000001");
  });

  it("round-trips", () => {
    const value = simhash(tok("Apple Reports Third Quarter Fiscal Results"));
    assert.equal(fromHex(toHex(value)), value);
  });
});

describe("normalizeTitle", () => {
  it("strips an appended publisher", () => {
    assert.equal(
      normalizeTitle("Apple Reports Results - Reuters"),
      "apple reports results",
    );
  });

  it("strips corporate suffixes", () => {
    assert.equal(normalizeTitle("Apple Inc. Reports Results"), "apple reports results");
  });

  it("normalises curly punctuation and hyphens", () => {
    assert.equal(
      normalizeTitle("Apple’s Third-Quarter Results"),
      normalizeTitle("Apple's Third Quarter Results"),
    );
  });

  it("collapses whitespace", () => {
    assert.equal(normalizeTitle("  Apple   reports  "), "apple reports");
  });
});

describe("jaccard", () => {
  it("is 1 for identical sets", () => {
    assert.equal(jaccard(["a", "b"], ["b", "a"]), 1);
  });

  it("is 0 for disjoint sets", () => {
    assert.equal(jaccard(["a"], ["b"]), 0);
  });

  it("computes partial overlap", () => {
    assert.equal(jaccard(["a", "b"], ["b", "c"]), 1 / 3);
  });

  it("treats two empty sets as identical", () => {
    assert.equal(jaccard([], []), 1);
  });

  it("treats one empty set as disjoint", () => {
    assert.equal(jaccard(["a"], []), 0);
  });
});
