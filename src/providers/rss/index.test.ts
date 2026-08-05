import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFeed, type FeedTemplate } from "./index";

/**
 * Fixtures mirror the shapes real feeds emit. Live feed hosts are not
 * contacted here, so this is what stands behind the parser's correctness.
 */

const FEED: FeedTemplate = {
  key: "rss:test",
  name: "Test Feed",
  kind: "aggregator",
  urlTemplate: "https://example.com/{ticker}",
};

const RSS_2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example news</title>
    <item>
      <title>Apple Reports Third Quarter Results - Reuters</title>
      <link>https://example.com/apple-q3?utm_source=rss</link>
      <pubDate>Tue, 29 Oct 2024 13:05:00 GMT</pubDate>
      <description>&lt;p&gt;Apple &lt;b&gt;announced&lt;/b&gt; results today.&lt;/p&gt;</description>
      <source url="https://reuters.com">Reuters</source>
    </item>
    <item>
      <title>Apple Names New CFO</title>
      <link>https://example.com/apple-cfo</link>
      <pubDate>Mon, 28 Oct 2024 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title>
  <entry>
    <title>Nvidia Unveils New Platform</title>
    <link rel="alternate" href="https://example.com/nvidia-platform"/>
    <published>2024-10-29T10:00:00Z</published>
    <summary>A new product line was introduced.</summary>
  </entry>
</feed>`;

describe("parseFeed — RSS 2.0", () => {
  const items = parseFeed(RSS_2, FEED);

  it("reads every item", () => {
    assert.equal(items.length, 2);
  });

  it("reads title, link and date", () => {
    assert.equal(items[0]?.title, "Apple Reports Third Quarter Results - Reuters");
    assert.equal(items[0]?.url, "https://example.com/apple-q3?utm_source=rss");
    assert.equal(items[0]?.publishedAt.toISOString(), "2024-10-29T13:05:00.000Z");
  });

  it("strips HTML and decodes entities in the snippet", () => {
    assert.equal(items[0]?.snippet, "Apple announced results today.");
  });

  it("reads the publisher from the source element", () => {
    assert.equal(items[0]?.publisher, "Reuters");
  });

  it("tolerates a missing description and source", () => {
    assert.equal(items[1]?.snippet, null);
    assert.equal(items[1]?.publisher, null);
  });

  it("stamps the configured source", () => {
    assert.equal(items[0]?.sourceKey, "rss:test");
    assert.equal(items[0]?.sourceKind, "aggregator");
  });
});

describe("parseFeed — Atom", () => {
  it("reads entries and resolves the alternate link", () => {
    const items = parseFeed(ATOM, FEED);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.title, "Nvidia Unveils New Platform");
    assert.equal(items[0]?.url, "https://example.com/nvidia-platform");
    assert.equal(items[0]?.publishedAt.toISOString(), "2024-10-29T10:00:00.000Z");
  });
});

describe("parseFeed — malformed input", () => {
  it("returns nothing for an empty document", () => {
    assert.deepEqual(parseFeed("<rss><channel></channel></rss>", FEED), []);
  });

  it("skips entries missing a title, link or date", () => {
    const partial = `<rss><channel>
      <item><title>No link or date</title></item>
      <item><link>https://example.com/x</link><pubDate>Tue, 29 Oct 2024 13:05:00 GMT</pubDate></item>
      <item><title>Good</title><link>https://example.com/g</link><pubDate>Tue, 29 Oct 2024 13:05:00 GMT</pubDate></item>
    </channel></rss>`;
    const items = parseFeed(partial, FEED);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.title, "Good");
  });

  it("skips an unparseable date rather than emitting an invalid one", () => {
    const bad = `<rss><channel><item>
      <title>T</title><link>https://example.com/t</link><pubDate>not a date</pubDate>
    </item></channel></rss>`;
    assert.deepEqual(parseFeed(bad, FEED), []);
  });

  it("handles a single item not wrapped in an array", () => {
    const single = `<rss><channel><item>
      <title>Only one</title><link>https://example.com/one</link>
      <pubDate>Tue, 29 Oct 2024 13:05:00 GMT</pubDate>
    </item></channel></rss>`;
    assert.equal(parseFeed(single, FEED).length, 1);
  });
});
