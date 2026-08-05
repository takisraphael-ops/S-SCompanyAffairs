import type { NewsProvider, NewsTarget, RawArticle } from "../types";

const MS_PER_DAY = 86_400_000;

/**
 * Deterministic fake news so the app is usable and demonstrable with no keys.
 *
 * It deliberately reproduces the three things that make real feeds hard:
 *
 *   - the same press release restated by several outlets with slightly
 *     different headlines, so story clustering has something to collapse;
 *   - a stock-picking listicle, so materiality ranking has something to bury;
 *   - an article naming a second company, so cross-linking has something to
 *     find.
 *
 * Output is stable for a given ticker and day, which keeps re-running ingest
 * idempotent and makes the dedup behaviour reproducible.
 */

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Peers used for cross-mentions; only those on the watchlist will link. */
const PEERS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL"];

interface Template {
  /** Distinct wordings of the same underlying event share a groupKey. */
  groupKey: string;
  title: (t: NewsTarget) => string;
  snippet: (t: NewsTarget) => string;
  publisher: string;
  sourceKey: string;
  sourceName: string;
  kind: "wire" | "outlet" | "aggregator";
  /** Days before today. */
  ageDays: number;
}

const TEMPLATES: Template[] = [
  // One earnings release, three restatements. These should collapse to one story.
  {
    groupKey: "earnings",
    title: (t) => `${t.name} Reports Third Quarter Fiscal Results`,
    snippet: (t) =>
      `${t.name} today announced financial results for its third fiscal quarter, reporting revenue growth and margin expansion versus the prior year.`,
    publisher: "Business Wire",
    sourceKey: "mock:wire",
    sourceName: "Mock Wire",
    kind: "wire",
    ageDays: 1,
  },
  {
    groupKey: "earnings",
    title: (t) => `${t.name} Reports Third Quarter Fiscal Results - Reuters`,
    snippet: (t) =>
      `${t.name} announced financial results for the third fiscal quarter, reporting revenue growth and margin expansion from a year earlier.`,
    publisher: "Reuters",
    sourceKey: "mock:outlet",
    sourceName: "Mock Newsroom",
    kind: "outlet",
    ageDays: 1,
  },
  {
    groupKey: "earnings",
    title: (t) => `${t.name} Inc. Reports Third-Quarter Fiscal Results`,
    snippet: (t) =>
      `${t.name} has announced its financial results for the third fiscal quarter, with revenue growth and margin expansion year over year.`,
    publisher: "MarketAggregator",
    sourceKey: "mock:aggregator",
    sourceName: "Mock Aggregator",
    kind: "aggregator",
    ageDays: 1,
  },
  {
    groupKey: "leadership",
    title: (t) => `${t.name} Names New Chief Financial Officer`,
    snippet: (t) =>
      `${t.name} said its board appointed a new chief financial officer, effective next quarter. The outgoing CFO will remain as an adviser through the transition.`,
    publisher: "Business Wire",
    sourceKey: "mock:wire",
    sourceName: "Mock Wire",
    kind: "wire",
    ageDays: 3,
  },
  {
    groupKey: "product",
    title: (t) => `${t.name} Unveils Next Generation Platform`,
    snippet: (t) =>
      `${t.name} introduced a new product line at its annual event, with general availability expected later this year.`,
    publisher: "Mock Newsroom",
    sourceKey: "mock:outlet",
    sourceName: "Mock Newsroom",
    kind: "outlet",
    ageDays: 5,
  },
  {
    groupKey: "guidance",
    title: (t) => `${t.name} Raises Full-Year Outlook`,
    snippet: (t) =>
      `${t.name} lifted its full-year revenue guidance, citing stronger demand than it had forecast at the start of the year.`,
    publisher: "Business Wire",
    sourceKey: "mock:wire",
    sourceName: "Mock Wire",
    kind: "wire",
    ageDays: 6,
  },
  // Commentary rather than company news; should rank near the bottom.
  {
    groupKey: "opinion",
    title: (t) => `3 Reasons To Buy ${t.name} Stock Before It Explodes`,
    snippet: (t) =>
      `Here's why ${t.name} could be a no-brainer buy for patient investors looking at the next decade.`,
    publisher: "MarketAggregator",
    sourceKey: "mock:aggregator",
    sourceName: "Mock Aggregator",
    kind: "aggregator",
    ageDays: 2,
  },
  {
    groupKey: "analyst",
    title: (t) => `Analyst Raises ${t.ticker} Price Target After Results`,
    snippet: (t) =>
      `A research note lifted its price target on ${t.name}, maintaining an overweight rating following the quarter.`,
    publisher: "MarketAggregator",
    sourceKey: "mock:aggregator",
    sourceName: "Mock Aggregator",
    kind: "aggregator",
    ageDays: 2,
  },
];

export class MockNewsProvider implements NewsProvider {
  readonly name = "mock-news";

  async getCompanyNews(target: NewsTarget, since: Date): Promise<RawArticle[]> {
    const seed = hashSeed(target.ticker);
    const today = Math.floor(Date.now() / MS_PER_DAY);
    const slug = target.ticker.toLowerCase();

    const articles: RawArticle[] = TEMPLATES.map((template, i) => {
      const publishedAt = new Date(
        (today - template.ageDays) * MS_PER_DAY + ((seed + i) % 20) * 3_600_000,
      );

      return {
        title: template.title(target),
        // Distinct URL per outlet so clustering is exercised by text, not URL.
        url: `https://${template.sourceKey.replace(/^mock:/, "")}.example.com/${slug}/${template.groupKey}-${i}?utm_source=mock&utm_campaign=demo`,
        publishedAt,
        snippet: template.snippet(target),
        publisher: template.publisher,
        tickers: [target.ticker],
        sourceKey: template.sourceKey,
        sourceName: template.sourceName,
        sourceKind: template.kind,
      };
    });

    /*
     * An article naming a second company, so cross-linking has a real case.
     *
     * Chosen from the first two remaining peers rather than all of them: the
     * point of this fixture is to exercise the cross-link path, and picking
     * across the whole pool frequently lands on a company that is not on the
     * watchlist, leaving that path silently untested.
     */
    const peer = PEERS.filter((p) => p !== target.ticker)[seed % 2] ?? "MSFT";
    articles.push({
      title: `${target.name} Signs Multi-Year Supply Agreement With $${peer}`,
      url: `https://wire.example.com/${slug}/supply-agreement-${peer.toLowerCase()}`,
      publishedAt: new Date((today - 4) * MS_PER_DAY + 43_200_000),
      snippet: `${target.name} announced a multi-year supply agreement. The companies said deliveries begin next year.`,
      publisher: "Business Wire",
      tickers: [target.ticker],
      sourceKey: "mock:wire",
      sourceName: "Mock Wire",
      sourceKind: "wire",
    });

    return articles.filter((a) => a.publishedAt >= since);
  }
}
