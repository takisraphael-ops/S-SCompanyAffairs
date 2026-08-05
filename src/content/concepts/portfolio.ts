import type { ConceptSource } from "../types";

const category = "Portfolio" as const;

export const portfolio: ConceptSource[] = [
  {
    slug: "position",
    term: "Position",
    aliases: ["holding"],
    category,
    level: "beginner",
    metrics: ["quantity"],
    oneLiner: "The shares of one company you own, and what they are currently worth.",
    body: `A position is a single holding: how many shares of one company you own, what you paid, and what it is worth now.

Position **size** — the share of your total portfolio it represents — matters more than most people expect. A stock that doubles moves your outcome very differently depending on whether it was 2% or 30% of the portfolio.

Sizing is also the main lever you actually control. You cannot make an investment work out, but you can decide in advance how much it matters if it does not.`,
  },
  {
    slug: "cost-basis",
    term: "Cost basis",
    aliases: ["book cost", "average price paid"],
    category,
    level: "beginner",
    requires: ["position"],
    metrics: ["cost_basis"],
    oneLiner:
      "What you actually paid for the shares you hold, including fees — the baseline for gains and taxes.",
    body: `Cost basis is the total you paid for a position, including commissions. It is the number every gain calculation is measured against, and the one tax authorities care about.

It gets complicated as soon as you buy the same stock more than once at different prices. Selling part of a position raises the question of *which* shares you sold, and the answer changes the gain — see [FIFO](/learn/fifo) and [average cost](/learn/average-cost).

[Stock splits](/learn/stock-split) and certain dividends also adjust it. A cost basis that ignores a 4-for-1 split will overstate your gain by a factor of four, which is why this app models corporate actions explicitly rather than storing a single mutable number.`,
  },
  {
    slug: "fifo",
    term: "FIFO",
    aliases: ["first in first out"],
    category,
    level: "intermediate",
    requires: ["cost-basis"],
    oneLiner:
      "A cost basis method that assumes the shares you sell are the ones you bought earliest.",
    body: `Under first-in-first-out, selling 50 shares means selling the 50 you have held longest, at whatever you paid then.

It is the default in many jurisdictions. In a position built over a rising market it produces the largest taxable gain, because the oldest shares were the cheapest.

The alternative methods — [average cost](/learn/average-cost), or specifically identifying which lots to sell — can produce materially different tax outcomes from identical trades. Which are permitted depends on where you are.`,
  },
  {
    slug: "average-cost",
    term: "Average cost",
    category,
    level: "intermediate",
    requires: ["cost-basis"],
    oneLiner:
      "A cost basis method that pools every purchase into one blended price per share.",
    body: `Average cost divides everything paid across every share held, so each share carries the same basis regardless of when it was bought.

    average cost = total paid ÷ total shares held

It is simpler to track than [FIFO](/learn/fifo) and removes the question of which shares were sold. It also removes the ability to choose, which forfeits the tax planning that specific-lot identification allows.

The important thing is consistency. Mixing methods across periods produces numbers that are wrong in ways that are very hard to unpick later.`,
  },
  {
    slug: "unrealized-gain",
    term: "Unrealised gain",
    aliases: ["paper gain", "open profit"],
    category,
    level: "beginner",
    requires: ["cost-basis", "price"],
    metrics: ["unrealized_gain"],
    oneLiner:
      "Profit on paper — the value of what you hold above what you paid, before selling.",
    body: `    unrealised gain = (current price − cost basis per share) × shares held

It is real in the sense that you could sell and collect it, and unreal in the sense that you have not, and it can evaporate before you do.

In most tax systems unrealised gains are not taxed. That asymmetry has consequences: selling converts a flexible position into a fixed tax bill, which is why the decision to sell is rarely just about the price.`,
  },
  {
    slug: "realized-gain",
    term: "Realised gain",
    category,
    level: "beginner",
    requires: ["cost-basis"],
    metrics: ["realized_gain"],
    oneLiner: "Profit locked in by actually selling — the amount that is usually taxable.",
    body: `A gain becomes realised when you sell. The proceeds minus the [cost basis](/learn/cost-basis) of the shares sold is the realised gain, and it is generally the taxable event.

How long you held matters. Many jurisdictions tax long-held positions at a lower rate than short-term ones, sometimes substantially, which can make the holding period worth more than a few percent of price movement.

Keeping realised and [unrealised](/learn/unrealized-gain) gains separate is essential. Combining them produces a number that describes neither your tax position nor your portfolio's performance.`,
  },
  {
    slug: "market-value",
    term: "Market value",
    aliases: ["position value"],
    category,
    level: "beginner",
    requires: ["position", "price"],
    metrics: ["market_value"],
    oneLiner:
      "What a holding is worth right now: shares held times the current price.",
    body: `    market value = shares held × current price

It is what you would receive if you sold everything at the last traded price, before fees and tax — and it moves every time the price does, whether or not you do anything.

Comparing it to [cost basis](/learn/cost-basis) gives the [unrealised gain](/learn/unrealized-gain). Comparing it to the rest of the portfolio gives [position weight](/learn/position-weight).

For a thinly traded holding it is optimistic. Market value assumes you could sell at the quoted price, which a large position in an illiquid stock cannot — see [liquidity](/learn/liquidity).`,
  },
  {
    slug: "position-weight",
    term: "Position weight",
    aliases: ["allocation", "position size"],
    category,
    level: "beginner",
    requires: ["market-value", "diversification"],
    metrics: ["position_weight"],
    oneLiner:
      "A holding's share of the whole portfolio, as a percentage of total market value.",
    body: `    weight = position market value ÷ total portfolio market value × 100

Weight is what decides how much any single holding actually matters. A stock that doubles changes your outcome very differently at 2% of the portfolio than at 30%.

It drifts on its own. Winners grow into a larger share and losers shrink, so a portfolio left alone becomes steadily more concentrated in whatever has already gone up — which is the opposite of what most people intend.

This is the number to look at before deciding whether you are [diversified](/learn/diversification). Ten holdings with one at 60% is not ten holdings in any meaningful sense.`,
  },
  {
    slug: "diversification",
    term: "Diversification",
    category,
    level: "beginner",
    requires: ["position"],
    oneLiner:
      "Spreading holdings across companies and industries so no single failure is decisive.",
    body: `Diversification reduces the damage any one mistake can do. Ten positions of 10% each mean a total loss in one costs you a tenth; a single position means it costs you everything.

The subtlety is that diversification is about *correlation*, not count. Ten semiconductor companies is barely diversified — they will fall together, because the thing that hurts one hurts all of them. Holdings that respond to different forces are what actually help.

It has a genuine cost: it guarantees you will never do as well as your best idea would have. That is the price of not being ruined by your worst.`,
  },
  {
    slug: "dollar-cost-averaging",
    term: "Dollar-cost averaging",
    aliases: ["DCA"],
    category,
    level: "beginner",
    requires: ["position"],
    oneLiner:
      "Investing a fixed amount at regular intervals rather than all at once.",
    body: `Buying $500 of something every month, regardless of price, buys more shares when it is cheap and fewer when it is expensive — so the average price paid ends up below the average price over the period.

Its real benefit is behavioural rather than mathematical. It removes the decision of when to buy, which is where most self-inflicted damage happens, and makes a falling market tolerable rather than paralysing.

Purely on expected return, investing a lump sum immediately usually wins, because markets rise more often than they fall. Dollar-cost averaging trades a little expected return for a large reduction in regret, which for most people is a good trade.`,
  },
];
