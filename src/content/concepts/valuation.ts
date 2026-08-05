import type { ConceptSource } from "../types";

const category = "Company size and valuation" as const;

export const valuation: ConceptSource[] = [
  {
    slug: "shares-outstanding",
    term: "Shares outstanding",
    category,
    level: "beginner",
    metrics: ["shares_outstanding"],
    oneLiner: "The total number of shares the company has issued and that are currently held.",
    body: `A company decides how many shares to divide itself into. That count is the shares outstanding, and it is the bridge between a share price and the value of the whole company.

The number moves. Companies issue new shares to raise money or to pay employees, which **dilutes** existing holders — each share becomes a smaller slice of the same business. They also buy shares back, which does the reverse. See [buybacks](/learn/buyback).

Watching this number over several years is genuinely informative. A company whose share count creeps up 4% annually is quietly transferring value from shareholders to employees, no matter what the headline earnings look like.`,
  },
  {
    slug: "float",
    term: "Float",
    aliases: ["public float", "free float"],
    category,
    level: "intermediate",
    requires: ["shares-outstanding"],
    oneLiner:
      "The portion of shares actually available to trade, excluding insider and other locked-up holdings.",
    body: `Not every issued share is in circulation. Founders, executives, and strategic investors often hold large blocks that rarely trade. The float is what is left over — the shares genuinely available to the public.

A small float relative to [shares outstanding](/learn/shares-outstanding) makes a stock jumpier: the same amount of buying pressure hits a smaller pool of available shares, so prices move further.

Index providers usually weight by float rather than total shares, on the reasoning that locked-up shares are not really part of the investable market.`,
  },
  {
    slug: "market-cap",
    term: "Market capitalisation",
    aliases: ["market cap", "market value"],
    category,
    level: "beginner",
    requires: ["price", "shares-outstanding"],
    metrics: ["market_cap"],
    oneLiner:
      "What the market says the whole company is worth: share price times shares outstanding.",
    body: `Market cap is the number that makes companies comparable:

    market cap = price × shares outstanding

A $12 stock with 10 billion shares ($120bn) is a far larger company than a $900 stock with 20 million ($18bn). Share price alone tells you nothing; this is the correction for that.

Market cap is what people mean by "large cap" and "small cap". The boundaries are conventional rather than precise — roughly, above $10bn is large, $2–10bn mid, below $2bn small.

It is a measure of the equity only. To value the whole business including what it owes, see [enterprise value](/learn/enterprise-value).`,
  },
  {
    slug: "eps",
    term: "Earnings per share",
    aliases: ["EPS"],
    category,
    level: "beginner",
    requires: ["net-income", "shares-outstanding"],
    metrics: ["eps"],
    oneLiner: "Profit divided by share count — how much of the company's earnings each share represents.",
    body: `EPS takes [net income](/learn/net-income) and divides it by shares outstanding:

    EPS = net income ÷ shares outstanding

If a company earns $2bn and has 1bn shares, EPS is $2.

You will see two versions. **Basic** EPS uses current shares; **diluted** EPS assumes every outstanding option and convertible turns into stock. Diluted is the conservative figure and the one worth using, because those claims on the company are real even before they are exercised.

Because it is a per-share number, EPS can rise without the business improving at all — buying back shares shrinks the denominator. Always read it alongside the trend in revenue and share count.`,
  },
  {
    slug: "pe-ratio",
    term: "Price-to-earnings ratio",
    aliases: ["P/E", "PE ratio", "earnings multiple"],
    category,
    level: "intermediate",
    requires: ["price", "eps"],
    metrics: ["pe_ratio"],
    oneLiner:
      "Share price divided by earnings per share — how many years of current profits you are paying for.",
    body: `The most quoted valuation figure there is:

    P/E = price ÷ earnings per share

A stock at $200 with $8 of EPS trades at 25 times earnings. Read literally, you are paying 25 years of current profit for a claim on the business.

A high P/E is not "expensive" and a low one is not "cheap". The multiple is a statement about expected growth: the market pays more per dollar of today's earnings when it expects many more dollars tomorrow. A low P/E frequently means the market expects earnings to fall.

Two caveats worth internalising. P/E is meaningless when earnings are negative or near zero — the ratio explodes or goes negative and tells you nothing. And it is only comparable within an industry; software and grocery retail have structurally different multiples for good reasons.`,
  },
  {
    slug: "forward-pe",
    term: "Forward P/E",
    category,
    level: "intermediate",
    requires: ["pe-ratio", "guidance"],
    oneLiner:
      "The P/E computed from forecast future earnings rather than reported past ones.",
    body: `The ordinary [P/E](/learn/pe-ratio) uses earnings already reported. The forward P/E substitutes an estimate of next year's, usually the average of analyst forecasts.

For a growing company the forward figure is lower, sometimes dramatically — a stock at 40 times trailing earnings might be 25 times forward earnings if profits are expected to grow 60%.

The catch is that a forecast is not a fact. Forward P/E inherits every optimism and error in the estimates behind it, and those estimates are revised downward far more often than the headline number suggests. Treat a low forward P/E as a claim to be checked, not a discount to be collected.`,
  },
  {
    slug: "peg-ratio",
    term: "PEG ratio",
    category,
    level: "advanced",
    requires: ["pe-ratio"],
    oneLiner:
      "P/E divided by the earnings growth rate — an attempt to compare valuations across different growth rates.",
    body: `PEG tries to answer the obvious objection to [P/E](/learn/pe-ratio): that fast-growing companies deserve higher multiples.

    PEG = P/E ÷ annual earnings growth rate (in percent)

A company at 30 times earnings growing 30% a year has a PEG of 1.0; so does one at 10 times growing 10%. The rule of thumb treats PEG below 1 as attractive.

Treat it as a rough sorting device rather than a valuation. It is highly sensitive to which growth rate you use — past, forecast, one year, five — and small changes flip the conclusion. It also breaks entirely for companies with negative or erratic growth.`,
  },
  {
    slug: "price-to-sales",
    term: "Price-to-sales ratio",
    aliases: ["P/S"],
    category,
    level: "intermediate",
    requires: ["market-cap", "revenue"],
    metrics: ["ps_ratio"],
    oneLiner: "Market cap divided by revenue — a valuation measure that still works when there are no profits.",
    body: `    P/S = market cap ÷ annual revenue

Its value is that revenue is almost always positive, so P/S produces a usable number for young or loss-making companies where [P/E](/learn/pe-ratio) does not.

Its weakness is that it ignores whether the revenue is worth anything. A dollar of software revenue at 80% [gross margin](/learn/gross-margin) is worth far more than a dollar of distribution revenue at 4%. Comparing P/S across industries is close to meaningless; comparing it between direct competitors is reasonable.`,
  },
  {
    slug: "price-to-book",
    term: "Price-to-book ratio",
    aliases: ["P/B"],
    category,
    level: "intermediate",
    requires: ["market-cap", "book-value"],
    metrics: ["pb_ratio"],
    oneLiner:
      "Market cap divided by book value — what the market pays relative to the company's accounting net worth.",
    body: `    P/B = market cap ÷ book value

A P/B of 1 means the market values the company at exactly the accounting value of its net assets.

This works well for banks and insurers, where the balance sheet genuinely is the business and the assets are marked close to fair value. It works badly for software, pharmaceutical, and consumer brand companies, whose real assets — code, patents, brand — are largely absent from the balance sheet. Such companies routinely trade at ten or twenty times book without that meaning anything is wrong.`,
  },
  {
    slug: "enterprise-value",
    term: "Enterprise value",
    aliases: ["EV"],
    category,
    level: "advanced",
    requires: ["market-cap", "debt", "cash-and-equivalents"],
    oneLiner:
      "The value of the whole business regardless of how it is financed: market cap plus debt, minus cash.",
    body: `    enterprise value = market cap + total debt − cash

The intuition is acquisition. If you bought every share you would also inherit the company's debts, but you would get its cash pile — so the effective price is [market cap](/learn/market-cap) adjusted for both.

This makes companies with different financing comparable. Two businesses with identical operations but different debt loads have very different market caps and nearly identical enterprise values.

It is the numerator in the multiples professionals prefer, such as EV/[EBITDA](/learn/ebitda), for exactly that reason.`,
  },
];
