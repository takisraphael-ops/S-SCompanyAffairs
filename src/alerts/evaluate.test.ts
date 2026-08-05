import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateCondition,
  matchArticle,
  matchFiling,
  matchesTerm,
  type ConditionInput,
} from "./evaluate";
import { InvalidRuleError, describeRule, parseParams } from "./rules";

const AAPL = { id: "sec-1", ticker: "AAPL", name: "Apple Inc." };
const NOW = new Date(Date.UTC(2024, 5, 10, 15, 0));

function input(over: Partial<ConditionInput> = {}): ConditionInput {
  return {
    security: AAPL,
    price: 190,
    changePct: 1.2,
    nextEarningsAt: null,
    now: NOW,
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * Thresholds
 * ------------------------------------------------------------------ */

test("a price threshold holds only while it is exceeded", () => {
  const rule = { threshold: 200 };
  assert.equal(
    evaluateCondition("price_above", rule, input({ price: 210 })).holds,
    true,
  );
  assert.equal(
    evaluateCondition("price_above", rule, input({ price: 190 })).holds,
    false,
  );
});

test("a threshold exactly met does not fire", () => {
  // Strictly above, so a stock pinned at the level does not oscillate in and
  // out of firing on rounding alone.
  assert.equal(
    evaluateCondition("price_above", { threshold: 200 }, input({ price: 200 }))
      .holds,
    false,
  );
  assert.equal(
    evaluateCondition("price_below", { threshold: 200 }, input({ price: 200 }))
      .holds,
    false,
  );
});

test("a missing price is not a crossing in either direction", () => {
  // The trap: `null < 200` is false in JS but `null > 200` is too, and a
  // naive comparison would make an unquoted ticker look like it had fallen
  // below every threshold ever set on it.
  for (const kind of ["price_above", "price_below"] as const) {
    assert.equal(
      evaluateCondition(kind, { threshold: 200 }, input({ price: null })).holds,
      false,
      kind,
    );
  }
});

/*
 * The whole point of the phase. Arming lives in the caller, but the dedupe
 * key is the second line of defence, and it has to be stable across the
 * repeated evaluations of one standing condition.
 */
test("one standing condition produces one dedupe key all day", () => {
  const morning = evaluateCondition(
    "price_above",
    { threshold: 200 },
    input({ price: 210, now: new Date(Date.UTC(2024, 5, 10, 14, 0)) }),
  );
  const afternoon = evaluateCondition(
    "price_above",
    { threshold: 200 },
    input({ price: 245, now: new Date(Date.UTC(2024, 5, 10, 20, 30)) }),
  );
  assert.equal(morning.firing?.dedupeKey, afternoon.firing?.dedupeKey);
});

test("the next day is a new crossing", () => {
  const today = evaluateCondition(
    "price_above",
    { threshold: 200 },
    input({ price: 210 }),
  );
  const tomorrow = evaluateCondition(
    "price_above",
    { threshold: 200 },
    input({ price: 210, now: new Date(Date.UTC(2024, 5, 11, 15, 0)) }),
  );
  assert.notEqual(today.firing?.dedupeKey, tomorrow.firing?.dedupeKey);
});

test("different thresholds on the same day are different alerts", () => {
  const a = evaluateCondition("price_above", { threshold: 200 }, input({ price: 260 }));
  const b = evaluateCondition("price_above", { threshold: 250 }, input({ price: 260 }));
  assert.notEqual(a.firing?.dedupeKey, b.firing?.dedupeKey);
});

/* ------------------------------------------------------------------ *
 * Day moves
 * ------------------------------------------------------------------ */

test("a day move fires in either direction", () => {
  const up = evaluateCondition("price_move", { percent: 5 }, input({ changePct: 6.2 }));
  const down = evaluateCondition("price_move", { percent: 5 }, input({ changePct: -7.1 }));
  assert.equal(up.holds, true);
  assert.equal(down.holds, true);
  assert.match(up.firing!.title, /up 6\.2%/);
  assert.match(down.firing!.title, /down 7\.1%/);
});

/*
 * A fall and a recovery are two things that happened, not one. The direction
 * is in the key so the second one is not swallowed by the first.
 */
test("a fall and a recovery on the same day are two alerts", () => {
  const down = evaluateCondition("price_move", { percent: 5 }, input({ changePct: -6 }));
  const up = evaluateCondition("price_move", { percent: 5 }, input({ changePct: 6 }));
  assert.notEqual(down.firing?.dedupeKey, up.firing?.dedupeKey);
});

test("a move smaller than asked for does not fire", () => {
  assert.equal(
    evaluateCondition("price_move", { percent: 5 }, input({ changePct: 4.99 })).holds,
    false,
  );
});

/* ------------------------------------------------------------------ *
 * Earnings
 * ------------------------------------------------------------------ */

test("earnings fire inside the window and not outside it", () => {
  const near = new Date(Date.UTC(2024, 5, 13));
  const far = new Date(Date.UTC(2024, 6, 20));

  assert.equal(
    evaluateCondition("earnings_soon", { days: 7 }, input({ nextEarningsAt: near })).holds,
    true,
  );
  assert.equal(
    evaluateCondition("earnings_soon", { days: 7 }, input({ nextEarningsAt: far })).holds,
    false,
  );
});

test("an earnings date already past does not fire", () => {
  const past = new Date(Date.UTC(2024, 5, 1));
  assert.equal(
    evaluateCondition("earnings_soon", { days: 7 }, input({ nextEarningsAt: past })).holds,
    false,
  );
});

/*
 * Keyed on the earnings date itself, so a rule evaluated every half hour for
 * a week before the event still produces one notification.
 */
test("the whole run-up to one earnings date is one alert", () => {
  const at = new Date(Date.UTC(2024, 5, 14));
  const sixDaysOut = evaluateCondition(
    "earnings_soon",
    { days: 7 },
    input({ nextEarningsAt: at, now: new Date(Date.UTC(2024, 5, 8)) }),
  );
  const dayBefore = evaluateCondition(
    "earnings_soon",
    { days: 7 },
    input({ nextEarningsAt: at, now: new Date(Date.UTC(2024, 5, 13)) }),
  );
  assert.equal(sixDaysOut.firing?.dedupeKey, dayBefore.firing?.dedupeKey);
});

/* ------------------------------------------------------------------ *
 * Keyword matching
 * ------------------------------------------------------------------ */

test("terms match on word boundaries, not substrings", () => {
  assert.equal(matchesTerm("The board said nothing", "AI"), false);
  assert.equal(matchesTerm("A new AI accelerator", "ai"), true);
  assert.equal(matchesTerm("Shipping delays continue", "chip"), false);
  assert.equal(matchesTerm("Chip supply improves", "chip"), true);
});

test("a multi-word term survives a line break", () => {
  assert.equal(matchesTerm("signed a supply\n  agreement today", "supply agreement"), true);
});

/*
 * These come from a form. An unescaped one would either throw on an unbalanced
 * bracket or, worse, be interpreted as a pattern.
 */
test("regex metacharacters in a term are literal", () => {
  assert.doesNotThrow(() => matchesTerm("anything", "(unclosed"));
  assert.equal(matchesTerm("costs are up (a lot)", "(a lot)"), true);
  assert.equal(matchesTerm("aaaa", "a.*a"), false);
});

test("a cashtag matches despite the leading punctuation", () => {
  assert.equal(matchesTerm("shares of $AAPL rose", "$AAPL"), true);
});

/* ------------------------------------------------------------------ *
 * Article and filing rules
 * ------------------------------------------------------------------ */

const article = {
  id: "art-1",
  title: "Apple announces a multi-year supply agreement",
  snippet: "Deliveries begin next year.",
  url: "https://example.test/a",
  materiality: 0.72,
  publishedAt: NOW,
};

test("materiality rules fire at or above the threshold", () => {
  assert.ok(matchArticle("material_news", { minMateriality: 0.7 }, article, AAPL));
  assert.equal(matchArticle("material_news", { minMateriality: 0.8 }, article, AAPL), null);
});

test("an article fires once per rule, whatever matched it", () => {
  const byScore = matchArticle("material_news", { minMateriality: 0.5 }, article, AAPL);
  const byTerm = matchArticle("keyword", { terms: ["supply agreement"] }, article, AAPL);
  assert.equal(byScore?.dedupeKey, "article:art-1");
  assert.equal(byTerm?.dedupeKey, "article:art-1");
});

test("a keyword firing says which term matched", () => {
  const hit = matchArticle("keyword", { terms: ["buyback", "supply agreement"] }, article, AAPL);
  assert.match(hit!.body, /supply agreement/);
});

/*
 * An empty form list means "material", not "everything". Ten companies file
 * dozens of insider Form 4s a month; an alert that fires on all of them is
 * one nobody reads.
 */
test("an unfiltered filing rule skips routine forms", () => {
  const mk = (formType: string) => ({
    id: `f-${formType}`,
    formType,
    filedAt: NOW,
    url: "https://example.test/f",
  });

  assert.ok(matchFiling("new_filing", { formTypes: [] }, mk("8-K"), AAPL));
  assert.ok(matchFiling("new_filing", { formTypes: [] }, mk("10-K"), AAPL));
  assert.equal(matchFiling("new_filing", { formTypes: [] }, mk("4"), AAPL), null);
});

test("naming a form type asks for exactly that, routine or not", () => {
  const four = { id: "f-4", formType: "4", filedAt: NOW, url: "https://example.test/f" };
  assert.ok(matchFiling("new_filing", { formTypes: ["4"] }, four, AAPL));
  assert.equal(matchFiling("new_filing", { formTypes: ["8-K"] }, four, AAPL), null);
});

test("form types match regardless of case", () => {
  const filing = { id: "f-1", formType: "8-K", filedAt: NOW, url: "u" };
  assert.ok(matchFiling("new_filing", { formTypes: ["8-k"] }, filing, AAPL));
});

/* ------------------------------------------------------------------ *
 * Parameters
 * ------------------------------------------------------------------ */

test("parameters are validated, not trusted", () => {
  assert.throws(() => parseParams("price_above", { threshold: -5 }), InvalidRuleError);
  assert.throws(() => parseParams("price_above", {}), InvalidRuleError);
  assert.throws(() => parseParams("keyword", { terms: [] }), InvalidRuleError);
  assert.throws(() => parseParams("earnings_soon", { days: 0 }), InvalidRuleError);
  assert.throws(() => parseParams("price_move", { percent: 400 }), InvalidRuleError);
});

test("form fields arrive as strings and are coerced", () => {
  assert.deepEqual(parseParams("price_above", { threshold: "200.5" }), {
    threshold: 200.5,
  });
});

test("a rule reads as a sentence", () => {
  assert.equal(
    describeRule("price_above", { threshold: 200 }, "AAPL"),
    "AAPL rises above $200",
  );
  assert.equal(
    describeRule("new_filing", { formTypes: [] }, "Anything on your watchlist"),
    "Anything on your watchlist files anything material",
  );
});

/*
 * Params are jsonb; nothing stops a row predating a schema change. A rule
 * that cannot be read must be visible as broken rather than rendered as a
 * confident half-sentence.
 */
test("an unreadable rule says so instead of guessing", () => {
  assert.match(
    describeRule("price_above", { threshold: "not a number" }, "AAPL"),
    /could not be read/,
  );
});
