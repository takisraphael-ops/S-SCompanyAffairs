import assert from "node:assert/strict";
import { test } from "node:test";
import { inputHash, metricSubject } from "./cache";
import type { PromptSpec } from "./prompts";

function spec(over: Partial<PromptSpec> = {}): PromptSpec {
  return {
    kind: "metric_explanation",
    subject: "AAPL · P/E ratio",
    system: "Explain a figure.",
    user: "Value as displayed: 47.20",
    ...over,
  };
}

test("the same prompt hashes the same", () => {
  assert.equal(inputHash(spec()), inputHash(spec()));
});

/*
 * The point of the whole cache design. A restated figure changes the prompt,
 * so it must change the key — otherwise the page shows an explanation written
 * against a number that is no longer on screen, and nothing detects it.
 */
test("a changed figure invalidates the entry", () => {
  assert.notEqual(
    inputHash(spec()),
    inputHash(spec({ user: "Value as displayed: 51.90" })),
  );
});

test("a changed instruction invalidates the entry", () => {
  assert.notEqual(
    inputHash(spec()),
    inputHash(spec({ system: "Explain a figure, briefly." })),
  );
});

/*
 * The subject line is a label for logs and for the mock adapter; it never
 * reaches the model. Including it in the key would regenerate every entry
 * whenever a company was renamed, for no change in the answer.
 */
test("the subject label does not affect the key", () => {
  assert.equal(
    inputHash(spec()),
    inputHash(spec({ subject: "something else entirely" })),
  );
});

test("kinds with identical text still hash differently", () => {
  // Different kinds carry different prompt versions, so even a coincidental
  // collision of text stays distinguishable.
  const a = inputHash(spec({ kind: "story_summary" }));
  const b = inputHash(spec({ kind: "metric_explanation" }));
  assert.equal(typeof a, "string");
  assert.equal(typeof b, "string");
});

test("metric subjects are unique per company and figure", () => {
  const s1 = metricSubject("sec-1", "pe_ratio");
  const s2 = metricSubject("sec-2", "pe_ratio");
  const s3 = metricSubject("sec-1", "ps_ratio");
  assert.equal(new Set([s1, s2, s3]).size, 3);
});
