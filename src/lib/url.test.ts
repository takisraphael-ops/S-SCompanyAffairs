import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeUrl, hostnameOf } from "./url";

describe("canonicalizeUrl", () => {
  it("strips the utm family", () => {
    assert.equal(
      canonicalizeUrl(
        "https://example.com/story?utm_source=twitter&utm_medium=social&utm_campaign=x",
      ),
      "https://example.com/story",
    );
  });

  it("strips other tracking parameters but keeps real ones", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/a?id=42&fbclid=abc&ref=feed"),
      "https://example.com/a?id=42",
    );
  });

  it("drops the fragment", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/a#section-2"),
      "https://example.com/a",
    );
  });

  it("normalises scheme, www and trailing slash", () => {
    assert.equal(
      canonicalizeUrl("http://WWW.Example.com/story/"),
      "https://example.com/story",
    );
  });

  it("collapses AMP variants onto the canonical path", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/story/amp"),
      "https://example.com/story",
    );
  });

  it("orders query parameters so argument order does not matter", () => {
    assert.equal(
      canonicalizeUrl("https://example.com/a?b=2&a=1"),
      canonicalizeUrl("https://example.com/a?a=1&b=2"),
    );
  });

  it("gives the same key for the same article reached different ways", () => {
    const routes = [
      "https://example.com/story?utm_source=rss",
      "http://www.example.com/story/#top",
      "https://example.com/story/amp?fbclid=xyz",
    ];
    const keys = new Set(routes.map(canonicalizeUrl));
    assert.equal(keys.size, 1, [...keys].join(" | "));
  });

  it("keeps distinct articles distinct", () => {
    assert.notEqual(
      canonicalizeUrl("https://example.com/story-a"),
      canonicalizeUrl("https://example.com/story-b"),
    );
  });

  it("returns unparseable input unchanged rather than throwing", () => {
    assert.equal(canonicalizeUrl("not a url"), "not a url");
  });
});

describe("hostnameOf", () => {
  it("extracts the host without www", () => {
    assert.equal(hostnameOf("https://www.reuters.com/x/y"), "reuters.com");
  });

  it("returns null for junk", () => {
    assert.equal(hostnameOf("nope"), null);
  });
});
