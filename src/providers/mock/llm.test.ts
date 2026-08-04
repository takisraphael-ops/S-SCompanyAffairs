import assert from "node:assert/strict";
import { test } from "node:test";
import { CLASSIFIABLE_EVENT_TYPES, parseEventType } from "@/ai/prompts";
import type { LlmRequest } from "../types";
import { MockLlmProvider } from "./llm";

function req(over: Partial<LlmRequest> = {}): LlmRequest {
  return {
    kind: "story_summary",
    subject: "AAPL · Apple Reports Third Quarter Results",
    system: "Summarise.",
    user: "Headline: Apple Reports Third Quarter Results",
    maxTokens: 1500,
    tier: "fast",
    ...over,
  };
}

const provider = new MockLlmProvider();

test("placeholder text is identifiable as placeholder text", async () => {
  const r = await provider.complete(req());
  assert.equal(r.model, "mock");
  assert.match(r.text, /ANTHROPIC_API_KEY/);
});

test("output is deterministic, so re-running ingest is free", async () => {
  const a = await provider.complete(req());
  const b = await provider.complete(req());
  assert.equal(a.text, b.text);
});

test("different subjects produce different text", async () => {
  const a = await provider.complete(req({ subject: "AAPL · Q3 results" }));
  const b = await provider.complete(req({ subject: "MSFT · Q3 results" }));
  assert.notEqual(a.text, b.text);
});

/*
 * The one case where the placeholder's answer is written back to a column
 * rather than shown to a reader. "other" is what the keyword rules already
 * concluded, so answering it changes nothing — where a plausible-looking
 * guess would silently reclassify real news on a keyless install.
 */
test("the classifier placeholder answers 'other' and nothing else", async () => {
  const r = await provider.complete(
    req({ kind: "article_classification", subject: "Apple opens new campus" }),
  );
  assert.equal(parseEventType(r.text, CLASSIFIABLE_EVENT_TYPES), "other");
});

test("placeholder prose asserts nothing about the company", async () => {
  const r = await provider.complete(
    req({ kind: "metric_explanation", subject: "AAPL · P/E ratio" }),
  );
  // No figures, no direction, no judgement — the failure mode a placeholder
  // must not have is reading like an analysis.
  assert.doesNotMatch(r.text, /\d+(\.\d+)?%/);
  assert.doesNotMatch(r.text, /\b(cheap|expensive|undervalued|overvalued|buy|sell)\b/i);
});
