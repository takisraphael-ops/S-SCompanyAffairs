import assert from "node:assert/strict";
import { test } from "node:test";
import { composeDigest, type DigestSources } from "./digest";

const NOW = new Date(Date.UTC(2024, 5, 10, 11, 0));
const SINCE = new Date(Date.UTC(2024, 5, 9, 9, 0));

function row(over: Partial<DigestSources["news"][number]> = {}) {
  return {
    ticker: "AAPL",
    title: "Something happened",
    detail: "Details follow.",
    url: "https://example.test/a",
    ...over,
  };
}

function sources(over: Partial<DigestSources> = {}): DigestSources {
  return {
    alerts: [],
    filings: [],
    news: [],
    events: [],
    portfolioLine: null,
    since: SINCE,
    now: NOW,
    ...over,
  };
}

test("a quiet morning says so rather than being empty", () => {
  const digest = composeDigest(sources());
  assert.equal(digest.itemCount, 0);
  assert.match(digest.markdown, /Nothing happened/);
  // Not suppressed: a digest that only arrives when something happened trains
  // you to wonder whether it broke.
  assert.ok(digest.markdown.length > 0);
});

/*
 * The rule the whole digest hangs on. An 8-K that fired a rule and also
 * appeared in the filings query is one event; printing it twice in one screen
 * is how a reader learns to skim.
 */
test("an item an alert already reported is not repeated below it", () => {
  const shared = "https://example.test/8k";
  const digest = composeDigest(
    sources({
      alerts: [row({ title: "AAPL filed a 8-K", url: shared })],
      filings: [row({ title: "8-K", url: shared }), row({ title: "10-Q", url: "https://example.test/10q" })],
    }),
  );

  const headings = digest.sections.map((s) => s.heading);
  assert.deepEqual(headings, ["Alerts that fired", "New filings"]);

  const filingLines = digest.sections[1]!.lines;
  assert.equal(filingLines.length, 1, "the duplicated 8-K should be dropped");
  assert.match(filingLines[0]!, /10-Q/);
});

test("the same suppression applies to news", () => {
  const shared = "https://example.test/story";
  const digest = composeDigest(
    sources({
      alerts: [row({ title: "AAPL: big news", url: shared })],
      news: [row({ url: shared })],
    }),
  );
  assert.deepEqual(
    digest.sections.map((s) => s.heading),
    ["Alerts that fired"],
  );
});

test("an item with no link is never mistaken for a duplicate", () => {
  const digest = composeDigest(
    sources({
      alerts: [row({ url: null })],
      filings: [row({ url: null })],
    }),
  );
  assert.equal(digest.sections.length, 2);
});

/*
 * Order is the editorial decision. What you asked to be told comes before
 * what merely happened, and the portfolio — the number most likely to be
 * looked at and least likely to require anything of you — comes last.
 */
test("sections run from what you asked for to what you own", () => {
  const digest = composeDigest(
    sources({
      alerts: [row()],
      filings: [row({ url: "https://example.test/f" })],
      news: [row({ url: "https://example.test/n" })],
      events: [row({ title: "earnings", detail: "2024-06-14", url: null })],
      portfolioLine: "Value $1,000.00.",
    }),
  );

  assert.deepEqual(
    digest.sections.map((s) => s.heading),
    [
      "Alerts that fired",
      "New filings",
      "Material news",
      "Coming up this week",
      "Portfolio",
    ],
  );
});

test("empty sections are omitted, not rendered as headings with nothing under them", () => {
  const digest = composeDigest(sources({ news: [row()] }));
  assert.deepEqual(
    digest.sections.map((s) => s.heading),
    ["Material news"],
  );
  assert.doesNotMatch(digest.markdown, /New filings/);
});

test("the item count is what a reader would count", () => {
  const digest = composeDigest(
    sources({
      alerts: [row(), row({ url: "https://example.test/b" })],
      news: [row({ url: "https://example.test/c" })],
      portfolioLine: "Value $1,000.00.",
    }),
  );
  assert.equal(digest.itemCount, 4);
});

test("a long snippet is clipped on a word boundary", () => {
  const long = `${"word ".repeat(60)}end`;
  const digest = composeDigest(sources({ news: [row({ detail: long })] }));
  const line = digest.sections[0]!.lines[0]!;
  assert.match(line, /…/);
  assert.doesNotMatch(line, /wor…/, "should not cut mid-word");
});
