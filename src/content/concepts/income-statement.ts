import type { ConceptSource } from "../types";

const category = "Income statement" as const;

export const incomeStatement: ConceptSource[] = [
  {
    slug: "revenue",
    term: "Revenue",
    aliases: ["sales", "turnover", "top line"],
    category,
    level: "beginner",
    metrics: ["revenue"],
    oneLiner: "The total money a company brought in from selling things, before any costs.",
    body: `Revenue is the top line of the income statement — everything the company charged customers over the period, before a single expense is deducted.

It is the cleanest single measure of scale and of demand. Profit can be engineered up or down through accounting choices in a given quarter; revenue is harder to bend.

Revenue tells you nothing about whether the business is any good. A company can grow revenue rapidly while losing money on every sale. That is what the margin figures below are for.`,
  },
  {
    slug: "fiscal-year",
    term: "Fiscal year",
    aliases: ["FY", "financial year"],
    category,
    level: "beginner",
    oneLiner:
      "The twelve-month period a company uses for reporting, which often does not match the calendar year.",
    body: `Companies choose their own annual reporting cycle. Many use the calendar year, but plenty do not — Apple's fiscal year ends in late September, Microsoft's in June.

This causes real confusion. Apple's "fiscal 2025" covers roughly October 2024 to September 2025, so comparing it to another company's calendar 2025 compares partly different economic conditions.

Quarters inherit the same offset. A company's Q1 might be any three months of the year, which is worth checking before concluding that two companies had different quarters.`,
  },
  {
    slug: "cost-of-revenue",
    term: "Cost of revenue",
    aliases: ["COGS", "cost of goods sold"],
    category,
    level: "beginner",
    requires: ["revenue"],
    oneLiner: "The direct cost of producing what was sold — materials, manufacturing, hosting.",
    body: `Cost of revenue captures what it directly took to deliver the sales: raw materials, factory labour, payment processing, server capacity for a software product.

The word doing the work is *direct*. Salaries for the sales team, research spending, and head-office costs are not in here — they sit further down the income statement as operating expenses, because they do not scale one-for-one with each unit sold.

Where a company draws that line is a judgement call, and it varies. It is one reason [gross margins](/learn/gross-margin) are only loosely comparable between companies in different industries.`,
  },
  {
    slug: "gross-profit",
    term: "Gross profit",
    category,
    level: "beginner",
    requires: ["revenue", "cost-of-revenue"],
    metrics: ["gross_profit"],
    oneLiner: "Revenue minus the direct cost of producing it — what is left to cover everything else.",
    body: `    gross profit = revenue − cost of revenue

This is the money available to pay for research, sales, administration, interest and tax — and, if anything survives, to be profit.

It is the first real test of a business model. A company whose gross profit is thin has very little room to fund growth or absorb a bad year, no matter how fast its [revenue](/learn/revenue) is rising.`,
  },
  {
    slug: "gross-margin",
    term: "Gross margin",
    category,
    level: "beginner",
    requires: ["gross-profit"],
    metrics: ["gross_margin"],
    oneLiner: "Gross profit as a percentage of revenue — how much of each sale survives production costs.",
    body: `    gross margin = gross profit ÷ revenue × 100

A software company might keep 80 cents of every dollar; a supermarket keeps around 25; a commodity distributor might keep 5.

Gross margin is close to a structural property of the industry, which makes it useful in two ways. Comparing it between direct competitors reveals genuine advantage — pricing power, scale, better technology. Tracking it over time within one company is an early warning system: a margin sliding year after year usually means competition arriving or input costs rising, and it shows up here long before it reaches net profit.`,
  },
  {
    slug: "operating-income",
    term: "Operating income",
    aliases: ["operating profit", "EBIT"],
    category,
    level: "intermediate",
    requires: ["gross-profit"],
    metrics: ["operating_income"],
    oneLiner:
      "Profit from running the business, after all operating costs but before interest and tax.",
    body: `Take [gross profit](/learn/gross-profit) and subtract the costs of actually operating: research and development, sales and marketing, general and administrative.

What remains is operating income — the profit the business generates from its actual operations, before the effects of how it is financed (interest) and where it is domiciled (tax).

This makes it the fairest like-for-like comparison between two companies. Debt loads and tax rates differ for reasons that have nothing to do with whether the underlying business works.`,
  },
  {
    slug: "operating-margin",
    term: "Operating margin",
    category,
    level: "intermediate",
    requires: ["operating-income"],
    metrics: ["operating_margin"],
    oneLiner: "Operating income as a percentage of revenue — profitability of the core business.",
    body: `    operating margin = operating income ÷ revenue × 100

Where [gross margin](/learn/gross-margin) tests the product, operating margin tests the whole operation — including whether the company spends sensibly on getting customers and building things.

The interesting pattern is the gap between the two. A company with an 80% gross margin and a 5% operating margin is spending nearly everything it makes on sales and research. That can be an excellent investment in growth or a treadmill it cannot get off, and distinguishing the two is most of the work.`,
  },
  {
    slug: "net-income",
    term: "Net income",
    aliases: ["net profit", "earnings", "bottom line"],
    category,
    level: "beginner",
    requires: ["revenue"],
    metrics: ["net_income"],
    oneLiner: "What is left after every expense, including interest and tax — the bottom line.",
    body: `Net income is the final figure on the income statement: revenue minus every cost, including operating expenses, interest, and tax.

It is what [earnings per share](/learn/eps) is calculated from, and therefore what [P/E](/learn/pe-ratio) is built on.

It is also the most manipulable number on the statement. One-off gains from selling a building, write-downs, tax settlements and restructuring charges all land here and can swamp the operating picture in any single period. When net income and [operating income](/learn/operating-income) tell different stories, the operating figure is usually the more honest one, and [free cash flow](/learn/free-cash-flow) more honest still.`,
  },
  {
    slug: "net-margin",
    term: "Net margin",
    aliases: ["profit margin"],
    category,
    level: "intermediate",
    requires: ["net-income"],
    metrics: ["net_margin"],
    oneLiner: "Net income as a percentage of revenue — the share of each sales dollar that becomes profit.",
    body: `    net margin = net income ÷ revenue × 100

The most complete profitability measure, and for that reason the noisiest. It absorbs everything — operations, financing, tax, and any one-off item that happened to land in the period.

Use it for the long-run trend rather than the quarterly reading, and when it lurches, look up the income statement to find out which line caused it.`,
  },
  {
    slug: "ebitda",
    term: "EBITDA",
    category,
    level: "advanced",
    requires: ["operating-income"],
    oneLiner:
      "Earnings before interest, tax, depreciation and amortisation — a rough proxy for cash generation.",
    body: `EBITDA adds depreciation and amortisation back to [operating income](/learn/operating-income). Those are non-cash charges spreading the cost of past investments over time, so removing them gets closer to the cash the operations throw off.

It is popular for comparing capital-intensive businesses and for debt analysis, since lenders care about cash available to service interest.

It also deserves its reputation for abuse. Depreciation represents equipment that genuinely wears out and will genuinely need replacing; a company that reports healthy EBITDA while its assets crumble is not generating value. If EBITDA looks strong and [free cash flow](/learn/free-cash-flow) does not, believe the cash flow.`,
  },
];
