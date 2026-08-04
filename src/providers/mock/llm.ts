import type { LlmProvider, LlmRequest, LlmResult } from "../types";

/**
 * Deterministic stand-in text, so the AI layer runs with no API key.
 *
 * The same reasoning as the mock quote and news providers: a fresh install
 * should look like a working application rather than a broken one, and the
 * plumbing around generation — the cache key, the batch job, the placement in
 * the UI — is worth exercising whether or not a key is configured.
 *
 * Two constraints this deliberately accepts.
 *
 * It is **not a paraphrase**. It restates what the prompt already contains and
 * asserts nothing about the company beyond that, because inventing plausible
 * financial commentary is exactly the failure mode a placeholder must not
 * have. Nobody should be able to read a fabricated claim here and take it for
 * an analysis.
 *
 * It is **identifiable**. The provider name is stored with every row, so the
 * UI can label placeholder text differently from a real model's, and so
 * clearing the placeholders later is one delete.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  async complete(req: LlmRequest): Promise<LlmResult> {
    const text = render(req);
    return {
      text,
      model: "mock",
      // Roughly the real ratio, so the cost readout in the ingest summary is
      // structurally right even when it is free.
      inputTokens: Math.ceil((req.system.length + req.user.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
  }
}

function render(req: LlmRequest): string {
  const subject = req.subject.trim() || "this item";
  // One line, because it repeats on every row of the news feed. Long enough
  // to say what to do about it, short enough not to become the page.
  const suffix =
    "_Placeholder — no `ANTHROPIC_API_KEY` is configured. " +
    "Set one and re-run `npm run ingest:ai`._";

  switch (req.kind) {
    case "story_summary":
      return [
        `Several outlets are carrying the same report about ${subject}. ` +
          "The headlines below are the coverage this was clustered from — " +
          "read them for what was actually said.",
        suffix,
      ].join("\n\n");

    case "filing_summary":
      return [
        `${subject} was filed with the SEC and is linked in full above. ` +
          "A configured model would say here what the form contains and why " +
          "a company files one.",
        suffix,
      ].join("\n\n");

    /*
     * "other" — the one answer a placeholder is entitled to give.
     *
     * This kind's output is not prose shown to a reader; it is written back
     * to `articles.event_type` and reorders the feed. A stand-in that picked
     * a plausible-looking category would silently reclassify real news on an
     * install with no model configured, which is worse than doing nothing.
     * "other" is what the keyword rules already concluded, so answering it
     * changes nothing while still exercising the whole path.
     */
    case "article_classification":
      return "other";

    case "metric_explanation":
      return [
        `The figures for ${subject} are shown beside this note, and they are ` +
          "what a configured model would be asked to interpret — how the " +
          "number was arrived at, and what would make it high or low for a " +
          "company like this one.",
        suffix,
      ].join("\n\n");

    default:
      return [`Nothing generated for ${subject}.`, suffix].join("\n\n");
  }
}
