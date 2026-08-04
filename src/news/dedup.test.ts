import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simhash, toHex } from "@/lib/simhash";
import { normalizeTitle, tokenize } from "@/lib/text";
import { decideStory, type DedupCandidate } from "./dedup";

function fingerprint(title: string): { titleNormalized: string; simhash: string } {
  const titleNormalized = normalizeTitle(title);
  return { titleNormalized, simhash: toHex(simhash(tokenize(titleNormalized))) };
}

function candidate(title: string, storyId = "story-1"): DedupCandidate {
  return { id: `a-${title.slice(0, 12)}`, storyId, ...fingerprint(title) };
}

describe("decideStory — clustering syndicated copy", () => {
  it("clusters an identical headline", () => {
    const existing = [candidate("Apple Reports Third Quarter Results")];
    const decision = decideStory(
      fingerprint("Apple Reports Third Quarter Results"),
      existing,
    );
    assert.equal(decision.kind, "existing-story");
    assert.equal(decision.kind === "existing-story" && decision.reason, "title");
  });

  it("clusters a headline carrying an appended publisher", () => {
    const existing = [candidate("Apple Reports Third Quarter Results")];
    const decision = decideStory(
      fingerprint("Apple Reports Third Quarter Results - Reuters"),
      existing,
    );
    assert.equal(decision.kind, "existing-story");
  });

  it("clusters across a corporate suffix and hyphenation difference", () => {
    const existing = [candidate("Apple Reports Third Quarter Results")];
    const decision = decideStory(
      fingerprint("Apple Inc. Reports Third-Quarter Results"),
      existing,
    );
    assert.equal(decision.kind, "existing-story");
  });

  it("clusters across curly and straight punctuation", () => {
    const existing = [candidate("Apple’s Board Names New CFO")];
    const decision = decideStory(
      fingerprint("Apple's Board Names New CFO"),
      existing,
    );
    assert.equal(decision.kind, "existing-story");
  });
});

describe("decideStory — refusing to merge different stories", () => {
  it("keeps two different events about one company apart", () => {
    // 3 of 5 tokens shared. A looser threshold merges these and one vanishes.
    const existing = [candidate("Apple Names New CFO")];
    const decision = decideStory(fingerprint("Apple Names New CEO"), existing);
    assert.equal(decision.kind, "new-story");
  });

  it("keeps templated headlines about different companies apart", () => {
    // The case the scoping in src/ingest/news.ts also guards: corporate
    // headlines are templated, and only the company name differs.
    const existing = [candidate("Apple Reports Third Quarter Results")];
    const decision = decideStory(
      fingerprint("Microsoft Reports Third Quarter Results"),
      existing,
    );
    assert.equal(decision.kind, "new-story");
  });

  it("keeps two different supply deals apart", () => {
    const existing = [
      candidate("Microsoft Signs Multi-Year Supply Agreement With NVDA"),
    ];
    const decision = decideStory(
      fingerprint("Nvidia Signs Multi-Year Supply Agreement With AAPL"),
      existing,
    );
    assert.equal(decision.kind, "new-story");
  });

  it("starts a new story when there is nothing to compare against", () => {
    assert.equal(decideStory(fingerprint("Anything at all"), []).kind, "new-story");
  });

  it("does not merge unrelated headlines", () => {
    const existing = [candidate("Apple Raises Full-Year Outlook")];
    const decision = decideStory(
      fingerprint("Apple Reports Third Quarter Results"),
      existing,
    );
    assert.equal(decision.kind, "new-story");
  });
});

describe("decideStory — candidate selection", () => {
  it("returns the story id of the matched candidate", () => {
    const existing = [
      candidate("Something else entirely", "story-a"),
      candidate("Apple Reports Third Quarter Results", "story-b"),
    ];
    const decision = decideStory(
      fingerprint("Apple Reports Third Quarter Results"),
      existing,
    );
    assert.equal(
      decision.kind === "existing-story" ? decision.storyId : null,
      "story-b",
    );
  });
});
