import type { ConceptSource } from "../types";

const category = "Filings and events" as const;

export const filingsAndEvents: ConceptSource[] = [
  {
    slug: "sec-edgar",
    term: "SEC EDGAR",
    aliases: ["EDGAR"],
    category,
    level: "beginner",
    oneLiner:
      "The SEC's public database of every filing US-listed companies are required to submit.",
    body: `EDGAR is where companies file with the US Securities and Exchange Commission, and everything in it is public, free, and available the moment it is submitted.

This makes it the highest-quality source of company information there is. A journalist's summary of an earnings report is downstream of a document you can simply read yourself, hours earlier and without the interpretation.

It is also the primary source this app uses for company identity — legal name, [CIK](/learn/cik), exchange, industry classification — because it requires no API key and no commercial licence.`,
  },
  {
    slug: "cik",
    term: "CIK",
    aliases: ["Central Index Key"],
    category,
    level: "beginner",
    requires: ["sec-edgar"],
    oneLiner:
      "The SEC's permanent numeric identifier for a company — unlike a ticker, it is never reused.",
    body: `Every entity that files with the SEC gets a Central Index Key, a number that stays with it for life. Apple's is 320193, conventionally written zero-padded to ten digits as \`0000320193\`.

The reason to care: [tickers](/learn/ticker) are not stable identifiers. They change when companies rebrand, and they get reassigned to entirely different companies after a delisting. A CIK never does either.

Any system that tracks companies over time should key on CIK and treat the ticker as a display label. This app stores both.`,
  },
  {
    slug: "form-10-k",
    term: "Form 10-K",
    aliases: ["10-K", "annual report"],
    category,
    level: "beginner",
    requires: ["sec-edgar"],
    oneLiner:
      "The comprehensive annual report US public companies must file — the single best document about a business.",
    body: `The 10-K is the annual filing: audited financial statements, a detailed description of the business, and management's discussion of results.

Two sections repay reading even if you skip everything else. **Risk Factors** is where the company enumerates what could go wrong, in language reviewed by lawyers who do not want to be sued for omitting something. **Management's Discussion and Analysis** explains the year's numbers in the company's own words.

It is long, often over a hundred pages, and it is written to be accurate rather than persuasive — which is precisely what makes it more useful than the glossy annual report sent to shareholders.`,
  },
  {
    slug: "form-10-q",
    term: "Form 10-Q",
    aliases: ["10-Q", "quarterly report"],
    category,
    level: "beginner",
    requires: ["form-10-k"],
    oneLiner: "The quarterly financial report — shorter than a 10-K and unaudited.",
    body: `Companies file a 10-Q for each of the first three quarters; the fourth is folded into the annual [10-K](/learn/form-10-k).

It is a condensed update: financial statements, material changes, and a shorter management discussion. The figures are reviewed but not fully audited, which is one reason quarterly numbers are sometimes restated later.

The 10-Q is where a trend first becomes visible — a margin slipping for two consecutive quarters is a much stronger signal than one bad annual report.`,
  },
  {
    slug: "form-8-k",
    term: "Form 8-K",
    aliases: ["8-K", "current report"],
    category,
    level: "beginner",
    requires: ["sec-edgar"],
    oneLiner:
      "A filing announcing a material event between scheduled reports — the closest thing to real company news.",
    body: `An 8-K is filed when something significant happens that shareholders should not have to wait for the next quarterly report to learn: an acquisition, a CEO departure, bankruptcy, a major contract, the results themselves.

It must generally be filed within four business days, so it is fast as well as authoritative.

For following "what is actually happening to this business", 8-Ks outrank essentially all news coverage — they are the primary source that coverage is derived from. Each type of event has a numbered item, so \`Item 5.02\` always means a director or officer came or went, which makes 8-Ks unusually easy to classify automatically.`,
  },
  {
    slug: "form-4",
    term: "Form 4",
    aliases: ["insider transaction"],
    category,
    level: "intermediate",
    requires: ["sec-edgar"],
    oneLiner:
      "A disclosure filed when a company insider buys or sells that company's stock.",
    body: `Directors, officers and large shareholders must report their trades in company stock within two business days, on Form 4.

Insider *buying* is the more interesting signal. Executives sell for many mundane reasons — diversification, tax bills, scheduled plans — but they generally buy for only one.

Read them with care. Many sales happen under pre-arranged 10b5-1 plans set up months earlier, which makes them uninformative about current views. The filing indicates when that is the case.`,
  },
  {
    slug: "proxy-statement",
    term: "Proxy statement",
    aliases: ["DEF 14A"],
    category,
    level: "intermediate",
    requires: ["sec-edgar"],
    oneLiner:
      "The annual filing covering shareholder voting matters, executive pay, and board composition.",
    body: `Filed ahead of the annual meeting, the proxy statement covers what shareholders will vote on: director elections, auditor ratification, and executive compensation.

Its most useful content is the compensation discussion, which spells out exactly what management is paid *for*. A bonus tied to revenue growth produces different behaviour from one tied to return on capital, and this is where you find out which it is.

It also discloses who sits on the board and what else they do — useful for judging whether meaningful oversight exists.`,
  },
  {
    slug: "earnings-call",
    term: "Earnings call",
    category,
    level: "beginner",
    oneLiner:
      "The quarterly conference call where management presents results and answers analyst questions.",
    body: `After releasing quarterly results, companies hold a public call: prepared remarks from management, then unscripted questions from analysts.

The question-and-answer portion is the valuable part. Prepared remarks are written to be reassuring; the answers are given live, and what management declines to answer is often more informative than what it does.

Transcripts are widely available afterwards. Reading two or three consecutive quarters reveals whether a story is holding together or quietly changing.`,
  },
  {
    slug: "guidance",
    term: "Guidance",
    aliases: ["outlook", "forecast"],
    category,
    level: "intermediate",
    requires: ["earnings-call"],
    oneLiner:
      "Management's own forecast of future revenue or earnings, usually given alongside results.",
    body: `Guidance is what the company says it expects next quarter or next year. Not every company provides it, and some have stopped on the grounds that it encourages short-term thinking.

It routinely moves the share price more than the reported results do. A quarter that beat expectations paired with lowered guidance is usually punished, because the market prices the future rather than the past.

Guidance is also a target management sets for itself, which creates an incentive to set it conservatively enough to beat. Persistent small beats against persistently modest guidance is a pattern worth recognising for what it is.`,
  },
  {
    slug: "earnings-surprise",
    term: "Earnings surprise",
    aliases: ["beat", "miss"],
    category,
    level: "intermediate",
    requires: ["eps", "guidance"],
    oneLiner:
      "The gap between reported earnings and what analysts expected — the basis of 'beat' and 'miss' headlines.",
    body: `Analysts publish [EPS](/learn/eps) estimates; the average becomes the consensus. Reporting above it is a beat, below it a miss.

The share price reacts to the surprise, not the absolute result. Record profits that fall a cent short of consensus can send a stock down sharply, which looks irrational until you realise the expectation was already in the price.

Since consensus is partly shaped by company [guidance](/learn/guidance), small beats are common by construction. A large surprise in either direction is the one carrying real information.`,
  },
];
