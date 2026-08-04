import type { ConceptSource } from "../types";

const category = "Dividends and returns" as const;

export const dividendsAndReturns: ConceptSource[] = [
  {
    slug: "dividend",
    term: "Dividend",
    category,
    level: "beginner",
    metrics: ["dividend"],
    oneLiner: "A cash payment a company makes to its shareholders out of profits.",
    body: `A dividend is a direct distribution of cash to owners, usually quarterly in the US and typically quoted as an amount per share.

Paying one signals confidence: the board is committing to an ongoing cash outflow, and cutting a dividend later is read as an admission of trouble. That makes established dividends unusually sticky — companies will borrow to maintain them.

Not paying one signals nothing bad by itself. A company reinvesting everything into growth is making a defensible choice; young, fast-growing companies almost never pay dividends.`,
  },
  {
    slug: "dividend-yield",
    term: "Dividend yield",
    category,
    level: "beginner",
    requires: ["dividend", "price"],
    metrics: ["dividend_yield"],
    oneLiner:
      "Annual dividends as a percentage of the share price — the income return at today's price.",
    body: `    dividend yield = annual dividend per share ÷ price × 100

A stock at $100 paying $3 a year yields 3%.

Because price is the denominator, yield rises when the price falls. A yield that has climbed to 9% usually reflects a collapsing share price rather than management generosity, and often precedes a dividend cut. This trap is common enough to have a name: the yield trap.

Check the [payout ratio](/learn/payout-ratio) before treating a high yield as attractive.`,
  },
  {
    slug: "payout-ratio",
    term: "Payout ratio",
    category,
    level: "intermediate",
    requires: ["dividend", "eps"],
    metrics: ["payout_ratio"],
    oneLiner: "The share of earnings paid out as dividends — how sustainable the payment is.",
    body: `    payout ratio = dividend per share ÷ earnings per share × 100

A company earning $4 and paying $1 has a 25% payout ratio, leaving three quarters of profit for reinvestment.

Ratios above 100% mean the company is paying out more than it earns, funded from cash reserves or borrowing. That can be sustained briefly through a bad year but not indefinitely.

Comparing dividends to [free cash flow](/learn/free-cash-flow) rather than earnings is the stricter and better test, since dividends are paid in cash, not in accounting profit.`,
  },
  {
    slug: "ex-dividend-date",
    term: "Ex-dividend date",
    category,
    level: "intermediate",
    requires: ["dividend"],
    oneLiner:
      "The cutoff date: buy on or after it and you do not receive the upcoming dividend.",
    body: `To receive a declared dividend you must own the stock before the ex-dividend date. Buy on that date or later and the payment goes to the seller instead.

On the ex-dividend morning the share price typically opens lower by roughly the dividend amount, which is entirely mechanical — the company is about to be worth that much less cash per share. Nobody has lost anything.

This is why price charts and [previous close](/learn/previous-close) figures are usually dividend-adjusted. Without that adjustment every dividend would appear as a small crash.`,
  },
  {
    slug: "stock-split",
    term: "Stock split",
    category,
    level: "intermediate",
    requires: ["shares-outstanding", "price"],
    oneLiner:
      "Dividing existing shares into more, smaller ones — the price falls proportionally and nothing of value changes.",
    body: `In a 4-for-1 split every share becomes four, each worth a quarter as much. [Shares outstanding](/learn/shares-outstanding) quadruples, price quarters, [market cap](/learn/market-cap) is unchanged, and every holder owns exactly what they owned before.

The purpose is cosmetic: a lower price per share feels more accessible and makes small trades easier. A **reverse split** does the opposite, often to escape a delisting rule that requires a minimum price.

Splits matter enormously for record-keeping. A price series that is not split-adjusted shows a catastrophic-looking drop that never happened, and a [cost basis](/learn/cost-basis) that is not adjusted will compute wildly wrong gains. This app models corporate actions explicitly for that reason.`,
  },
  {
    slug: "price-return",
    term: "Price return",
    category,
    level: "beginner",
    requires: ["percent-change"],
    oneLiner: "The return from price movement alone, ignoring dividends.",
    body: `Price return measures only the change in share price between two dates:

    price return = (end price − start price) ÷ start price × 100

It is what most charts and most headline "the stock is up 12% this year" figures show.

For companies that pay meaningful dividends this understates what a holder actually earned, sometimes by a lot. Over long horizons the omission compounds into a serious distortion — see [total return](/learn/total-return).`,
  },
  {
    slug: "total-return",
    term: "Total return",
    category,
    level: "intermediate",
    requires: ["price-return", "dividend"],
    oneLiner:
      "The complete return including dividends, usually assuming they were reinvested.",
    body: `Total return adds dividends back to [price return](/learn/price-return), normally assuming each payment was reinvested into more shares.

The difference is not marginal. For a stock yielding 3%, price return and total return diverge by roughly 3% every year, and over two decades that gap compounds into a large fraction of the total outcome. Much of the long-run return of mature markets has historically come from dividends rather than price appreciation.

Whenever you compare two investments, check you are comparing the same measure. Comparing one's price return to another's total return is a common and badly misleading error.`,
  },
];
