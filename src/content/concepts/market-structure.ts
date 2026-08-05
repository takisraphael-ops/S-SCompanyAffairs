import type { ConceptSource } from "../types";

const category = "Market structure" as const;

export const marketStructure: ConceptSource[] = [
  {
    slug: "index",
    term: "Index",
    aliases: ["stock index", "benchmark"],
    category,
    level: "beginner",
    oneLiner:
      "A measure tracking a basket of stocks, used as a benchmark for the market or a segment of it.",
    body: `An index summarises a group of stocks in one number. It is not something you can buy directly — it is a calculation — though funds exist to track most major ones.

Indices matter mainly as benchmarks. "Up 14%" means something quite different in a year the broad market rose 30% than one where it fell 5%, and without a benchmark you cannot tell which you are in.

How an index weights its members changes what it measures. Weighting by [market cap](/learn/market-cap) means the largest companies dominate; the S&P 500's direction can be set by a handful of its members regardless of what the other 490 do.`,
  },
  {
    slug: "sp-500",
    term: "S&P 500",
    category,
    level: "beginner",
    requires: ["index", "market-cap"],
    oneLiner:
      "A market-cap-weighted index of 500 large US companies, the standard benchmark for US stocks.",
    body: `The S&P 500 tracks 500 of the largest US public companies, weighted by float-adjusted [market capitalisation](/learn/market-cap). It is the default answer to "how did the market do".

Membership is decided by a committee against published criteria, not purely by size — which is why some very large companies are absent and inclusion itself moves a stock, as index funds must then buy it.

Because it is cap-weighted it is more concentrated than "500 companies" suggests. In recent years the largest handful of members have accounted for a substantial share of the whole index's movement.`,
  },
  {
    slug: "sector",
    term: "Sector",
    category,
    level: "beginner",
    oneLiner:
      "A broad grouping of companies doing similar things, like Technology or Health Care.",
    body: `Sectors sort the market into around eleven broad buckets — Technology, Health Care, Financials, Energy, Consumer Staples and so on.

They are useful because companies within a sector tend to respond to the same forces: rising interest rates hit the whole of real estate, an oil price move moves all of energy. That is what makes sector concentration a [diversification](/learn/diversification) problem.

Sector labels are also where valuation comparisons become legitimate. A [P/E](/learn/pe-ratio) of 35 means something different in software than in utilities, and comparing across sectors without adjusting for that is one of the most common analytical errors.`,
  },
  {
    slug: "industry",
    term: "Industry",
    category,
    level: "beginner",
    requires: ["sector"],
    oneLiner: "A narrower classification within a sector — Semiconductors within Technology.",
    body: `Industries subdivide [sectors](/learn/sector) into more specific groupings: Technology contains Semiconductors, Software, IT Services and others.

The finer the classification, the more meaningful comparisons become. Two semiconductor companies genuinely face similar economics; a semiconductor company and a social network share a sector and almost nothing else.

Classification is imperfect for companies that span several businesses. A firm selling both hardware and subscriptions gets one label that describes it only partly, which is worth remembering when using industry averages.`,
  },
  {
    slug: "sic-code",
    term: "SIC code",
    aliases: ["Standard Industrial Classification"],
    category,
    level: "intermediate",
    requires: ["sec-edgar", "industry"],
    oneLiner:
      "The numeric industry classification the SEC assigns each filer — dated, but consistent and free.",
    body: `The Standard Industrial Classification is an older US government scheme, still used by the SEC to tag every filer. Apple's is 3571, "Electronic Computers".

The system dates from an economy of manufacturers and fits modern businesses awkwardly — the code says Apple makes computers, which describes a shrinking part of what it does.

It remains useful because it is attached to every EDGAR filing, applied consistently, and free. This app takes its industry description from here for exactly that reason.`,
  },
];
