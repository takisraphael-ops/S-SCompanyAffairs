import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METRIC_KEYS } from "@/lib/metrics";
import { ALL_CONCEPTS } from "./concepts";
import type { ConceptSource } from "./types";
import { findBrokenLinks, validateConcepts } from "./validate";

/**
 * The authored content is checked here as well as in the seeder, so a broken
 * cross-reference fails in CI rather than at the moment someone opens the page.
 */
describe("authored content", () => {
  it("passes validation", () => {
    const errors = validateConcepts(ALL_CONCEPTS);
    assert.deepEqual(errors, [], errors.join("\n"));
  });

  it("has no links to missing concepts", () => {
    const broken = findBrokenLinks(ALL_CONCEPTS);
    assert.deepEqual(broken, [], broken.join("\n"));
  });

  it("explains every metric the UI can render", () => {
    const owned = new Set(ALL_CONCEPTS.flatMap((c) => c.metrics ?? []));
    for (const key of METRIC_KEYS) {
      assert.ok(owned.has(key), `no concept explains metric "${key}"`);
    }
  });

  it("covers a meaningful amount of ground", () => {
    assert.ok(
      ALL_CONCEPTS.length >= 60,
      `only ${ALL_CONCEPTS.length} concepts`,
    );
  });
});

function base(overrides: Partial<ConceptSource> = {}): ConceptSource {
  return {
    slug: "thing",
    term: "Thing",
    oneLiner: "A thing.",
    body: "Body text.",
    level: "beginner",
    category: "Prices and trading",
    ...overrides,
  };
}

/**
 * These fixtures omit required metric coverage, so every case also reports the
 * missing-metric errors. Assertions match on the specific error being tested.
 */
function errorsFor(list: ConceptSource[]): string {
  return validateConcepts(list).join("\n");
}

describe("validateConcepts", () => {
  it("rejects a duplicate slug", () => {
    const out = errorsFor([base(), base({ term: "Other" })]);
    assert.match(out, /duplicate slug/);
  });

  it("rejects a non-kebab-case slug", () => {
    assert.match(errorsFor([base({ slug: "Not_Kebab" })]), /kebab-case/);
  });

  it("rejects an unresolvable prerequisite", () => {
    assert.match(
      errorsFor([base({ requires: ["nonexistent"] })]),
      /requires unknown concept "nonexistent"/,
    );
  });

  it("rejects a self-referencing prerequisite", () => {
    assert.match(
      errorsFor([base({ requires: ["thing"] })]),
      /lists itself as a prerequisite/,
    );
  });

  it("rejects a prerequisite cycle", () => {
    const out = errorsFor([
      base({ slug: "a", requires: ["b"] }),
      base({ slug: "b", requires: ["a"] }),
    ]);
    assert.match(out, /prerequisite cycle/);
  });

  it("rejects two concepts claiming the same metric", () => {
    const out = errorsFor([
      base({ slug: "a", metrics: ["price"] }),
      base({ slug: "b", metrics: ["price"] }),
    ]);
    assert.match(out, /claimed by both/);
  });

  it("rejects an over-long one-liner", () => {
    assert.match(
      errorsFor([base({ oneLiner: "x".repeat(200) })]),
      /keep it under 160/,
    );
  });

  it("rejects an unknown category", () => {
    assert.match(
      errorsFor([base({ category: "Nonsense" as never })]),
      /unknown category/,
    );
  });

  it("reports a rendered metric that nothing explains", () => {
    assert.match(errorsFor([base()]), /no concept explains it/);
  });
});

describe("findBrokenLinks", () => {
  it("flags a link to a concept that does not exist", () => {
    const out = findBrokenLinks([
      base({ body: "See [that](/learn/missing-thing)." }),
    ]);
    assert.equal(out.length, 1);
    assert.match(out[0]!, /missing-thing/);
  });

  it("accepts a link to a concept that does exist", () => {
    assert.deepEqual(
      findBrokenLinks([
        base({ slug: "a", body: "See [b](/learn/b)." }),
        base({ slug: "b" }),
      ]),
      [],
    );
  });

  it("ignores external links", () => {
    assert.deepEqual(
      findBrokenLinks([base({ body: "See [sec](https://sec.gov)." })]),
      [],
    );
  });
});
