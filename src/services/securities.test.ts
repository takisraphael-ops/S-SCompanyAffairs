import assert from "node:assert/strict";
import { test } from "node:test";
import { MockProvider } from "@/providers/mock";
import { isUnknownSymbol, type SymbolEvidence } from "./securities";

function evidence(over: Partial<SymbolEvidence> = {}): SymbolEvidence {
  return {
    hasProfile: false,
    quoteVouches: false,
    profileLookupConclusive: true,
    ...over,
  };
}

test("a symbol no reachable source recognises is rejected", () => {
  assert.equal(isUnknownSymbol(evidence()), true);
});

test("a company EDGAR knows is accepted", () => {
  assert.equal(isUnknownSymbol(evidence({ hasProfile: true })), false);
});

/*
 * Foreign listings and funds trade without being SEC registrants, so a quote
 * provider that knows the symbol is sufficient on its own.
 */
test("a symbol only the quote provider knows is accepted", () => {
  assert.equal(isUnknownSymbol(evidence({ quoteVouches: true })), false);
});

/*
 * The failure this protects against is a total lockout: EDGAR goes down, every
 * add starts failing, and nothing the user does helps. Letting an unverified
 * symbol through during an outage is the cheaper mistake — it leaves one row
 * to delete.
 */
test("an unreachable profile source does not reject the symbol", () => {
  assert.equal(
    isUnknownSymbol(evidence({ profileLookupConclusive: false })),
    false,
  );
});

/*
 * The regression this file exists for.
 *
 * The mock provider prices any string it is handed, so treating a successful
 * quote as proof of existence made every typo a permanent watchlist row on a
 * zero-config install — the exact configuration a first-time user runs.
 */
test("the mock quote provider does not vouch for symbols", () => {
  assert.equal(new MockProvider().canVerifySymbols, false);
});

test("a typo is rejected even though the mock provider prices it", async () => {
  const quote = await new MockProvider().getQuote("ZZZZQQ");
  assert.ok(quote.price > 0, "mock prices anything, which is the hazard");

  // What the caller must conclude from that price: nothing.
  assert.equal(isUnknownSymbol(evidence({ quoteVouches: false })), true);
});
