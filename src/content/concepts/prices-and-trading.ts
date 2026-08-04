import type { ConceptSource } from "../types";

const category = "Prices and trading" as const;

export const pricesAndTrading: ConceptSource[] = [
  {
    slug: "ticker",
    term: "Ticker symbol",
    aliases: ["symbol", "stock symbol"],
    category,
    level: "beginner",
    oneLiner:
      "The short code that identifies a company's stock on an exchange, like AAPL for Apple.",
    body: `A ticker is just a name tag. Exchanges need a short, unambiguous way to refer to each stock, so every listed company gets a code of one to five letters.

Tickers are only unique **within** a market. \`SHOP\` is Shopify in North America and something else in other markets, and codes get recycled after a company delists. This is why the app also stores each company's [CIK](/learn/cik) — a permanent identifier that never gets reused.

Companies with more than one class of stock get a suffix: Berkshire Hathaway trades as \`BRK.A\` and \`BRK.B\`. The two classes are different securities with different prices and different voting rights.`,
  },
  {
    slug: "exchange",
    term: "Exchange",
    aliases: ["stock exchange"],
    category,
    level: "beginner",
    oneLiner:
      "The marketplace where a stock is bought and sold, such as Nasdaq or the NYSE.",
    body: `An exchange is a venue that matches buyers with sellers and publishes the resulting prices. In the US the big two are the New York Stock Exchange and Nasdaq.

Which exchange a company lists on is mostly a matter of history and listing requirements; it says little about the business. What it does affect is the rules the company must follow to stay listed, and the hours during which its stock trades.

A company can be *listed* on one exchange while its shares actually change hands across many venues. The price you see is a consolidated view of that activity, not the record of a single building.`,
  },
  {
    slug: "price",
    term: "Price",
    aliases: ["last price", "last", "quote"],
    category,
    level: "beginner",
    metrics: ["price"],
    oneLiner:
      "What one share last traded for — the price of the most recent completed transaction.",
    body: `A stock's price is not a valuation or an opinion. It is a historical fact: the price at which the most recent trade actually happened.

That matters more than it sounds. The price tells you what *one* buyer and *one* seller agreed on for however many shares they exchanged. It does not promise you could buy or sell at that price now, particularly for a thinly traded stock — see [liquidity](/learn/liquidity).

Price on its own says nothing about whether a company is cheap or expensive. A $12 stock is not cheaper than a $900 stock; the two numbers are not comparable until you account for how many shares exist. That is what [market capitalisation](/learn/market-cap) does.`,
  },
  {
    slug: "delayed-quote",
    term: "Delayed quote",
    category,
    level: "beginner",
    requires: ["price"],
    oneLiner:
      "A price that is real but stale — typically 15 minutes behind the live market.",
    body: `Real-time market data is licensed and expensive. Free data feeds generally publish prices on a delay, most often 15 minutes.

A delayed quote is not wrong; it is simply the price as of a few minutes ago. For following companies you are interested in over weeks and months, this is irrelevant. For trading, it is disqualifying.

This app timestamps every quote with both when the provider says it was taken and when it was fetched. If those drift far apart, the ingest job has stalled — which is a different problem from the data being delayed.`,
  },
  {
    slug: "previous-close",
    term: "Previous close",
    aliases: ["prior close"],
    category,
    level: "beginner",
    metrics: ["previous_close"],
    oneLiner:
      "The final price from the last completed trading session — the baseline today's move is measured against.",
    body: `The closing price is the last trade of the regular session. It matters mostly as a reference point: nearly every "up 2% today" figure you see is measured from the previous close.

Closing prices are also the values used for most historical charts and return calculations, because they are unambiguous and comparable across days in a way that intraday prices are not.

One wrinkle: when a company pays a [dividend](/learn/dividend) or does a [stock split](/learn/stock-split), the previous close is normally *adjusted* so the change calculation does not show a fake crash. A stock that splits two-for-one halves in price overnight without anyone losing anything.`,
  },
  {
    slug: "change",
    term: "Change",
    aliases: ["day change", "net change"],
    category,
    level: "beginner",
    requires: ["price", "previous-close"],
    metrics: ["change"],
    oneLiner:
      "How many currency units the price has moved since the previous close.",
    body: `Change is simple subtraction:

    change = price − previous close

If a stock closed at $187.25 yesterday and trades at $189.50 now, the change is +$2.25.

The absolute figure is hard to compare between companies — $2.25 is a big move for a $12 stock and a rounding error for a $900 one. That is why it is almost always shown next to [percent change](/learn/percent-change), which normalises for the starting price.`,
  },
  {
    slug: "percent-change",
    term: "Percent change",
    aliases: ["% change", "day change percent"],
    category,
    level: "beginner",
    requires: ["change"],
    metrics: ["change_pct"],
    oneLiner:
      "The day's move expressed as a percentage of the previous close, so moves are comparable across companies.",
    body: `Percent change divides the move by where it started:

    percent change = (price − previous close) ÷ previous close × 100

A $2.25 gain on a $187.25 close is +1.20%.

This is the number to compare across companies, and against an [index](/learn/index) — it strips out the arbitrary effect of share price. Two companies both up 1.2% had equally good days regardless of whether their shares cost $12 or $900.

Watch the asymmetry: a 50% fall requires a 100% rise to get back to even. Percentage moves do not cancel out the way they intuitively seem to.`,
  },
  {
    slug: "day-range",
    term: "Day range",
    aliases: ["day high", "day low", "intraday range"],
    category,
    level: "beginner",
    requires: ["price"],
    metrics: ["day_high", "day_low"],
    oneLiner:
      "The highest and lowest prices traded so far today — a quick read on how choppy the session has been.",
    body: `The day's high and low bracket everything that happened during the session. The gap between them is a rough measure of how much disagreement there was about the price.

A narrow range means the market was settled. A wide one means something moved — news, earnings, a broad market swing — and the current price is only the latest point in a contested day.

Comparing the range to the stock's usual behaviour is more informative than the range alone. A 1% range is calm for a volatile growth stock and dramatic for a utility. See [volatility](/learn/volatility).`,
  },
  {
    slug: "volume",
    term: "Volume",
    category,
    level: "beginner",
    metrics: ["volume"],
    oneLiner: "The number of shares traded during a period — a measure of how much activity there was.",
    body: `Volume counts shares changing hands. Every trade has a buyer and a seller, so volume does not tell you which direction the pressure came from — only that there was a lot of it.

Its real use is as context for a price move. A 5% jump on ten times the usual volume means many participants acted on something. The same 5% on thin volume might be one large order pushing an inattentive market around, and is much more likely to reverse.

Volume is also the practical basis of [liquidity](/learn/liquidity): a stock that trades millions of shares a day can absorb your order without moving; one that trades a few thousand cannot.`,
  },
  {
    slug: "market-order",
    term: "Market order",
    category,
    level: "beginner",
    oneLiner:
      "An instruction to buy or sell immediately at whatever the current best price is.",
    body: `A market order prioritises certainty of execution over certainty of price. It will fill, essentially always, but you find out the price afterwards.

For a heavily traded stock in the middle of the session, the price you get will be very close to the one you saw. For a thinly traded one, or in the seconds after an earnings release, it can be materially worse — the order walks up the order book until it finds enough shares.

The failure mode to know about: placing a market order when the market is closed or barely open. It executes at whatever the first available price is, which can be far from the last price you saw.`,
  },
  {
    slug: "limit-order",
    term: "Limit order",
    category,
    level: "beginner",
    requires: ["market-order"],
    oneLiner:
      "An instruction to trade only at a specified price or better — it may not execute at all.",
    body: `A limit order is the mirror image of a [market order](/learn/market-order): it guarantees the price but not the fill. "Buy 100 shares at $185 or less" will never pay $186, and will simply sit unfilled if the stock never trades that low.

This is the safer default for anything other than the most liquid stocks, and it is the only sane choice around volatile events.

The trade-off is genuine. A limit order that misses by a cent leaves you holding nothing while the stock runs away. Certainty of price and certainty of execution are the two things you are choosing between.`,
  },
  {
    slug: "bid-ask-spread",
    term: "Bid-ask spread",
    aliases: ["spread", "bid", "ask"],
    category,
    level: "intermediate",
    requires: ["price"],
    oneLiner:
      "The gap between the highest price buyers will pay and the lowest sellers will accept.",
    body: `At any moment there are two prices, not one. The **bid** is the best price someone is currently willing to pay; the **ask** (or offer) is the lowest price someone will sell at. The ask is always higher.

The difference is the spread, and it is a real cost. Buying at the ask and immediately selling at the bid loses you the spread, before commissions. For a heavily traded large company the spread might be a cent on a $200 stock — trivial. For a small, rarely traded company it can be several percent.

The "price" you see quoted is usually the last trade, which sits somewhere between the two and may be stale. In a fast-moving market the bid and ask are the honest numbers.`,
  },
  {
    slug: "liquidity",
    term: "Liquidity",
    category,
    level: "intermediate",
    requires: ["volume", "bid-ask-spread"],
    oneLiner:
      "How easily you can trade a meaningful amount without pushing the price against yourself.",
    body: `A liquid stock has many buyers and sellers at any moment, so you can trade a reasonable quantity at close to the quoted price. An illiquid one does not, and your own order becomes part of the news.

The practical signals are high [volume](/learn/volume) and a narrow [bid-ask spread](/learn/bid-ask-spread). Both need to be judged relative to the size you intend to trade — a stock can be perfectly liquid for 100 shares and hopelessly illiquid for 100,000.

Liquidity is also not constant. It evaporates exactly when you most want it: during crashes, around earnings, and in the first and last minutes of the session.`,
  },
  {
    slug: "volatility",
    term: "Volatility",
    category,
    level: "intermediate",
    requires: ["percent-change"],
    oneLiner:
      "How much a price swings around, usually measured as the standard deviation of its returns.",
    body: `Volatility measures the size of a stock's typical move, in either direction. A stock that routinely moves 4% a day is more volatile than one that moves 0.5%, regardless of which way it ends up.

It is a description of variability, not of risk in the everyday sense, and certainly not of direction. A stock that rises steadily and relentlessly can be quite volatile; a stock that slowly grinds to zero need not be.

Volatility matters mainly for interpretation. Without it you cannot tell whether a 3% drop is an ordinary Tuesday or genuine news, and that judgement is most of what separating signal from noise consists of.`,
  },
  {
    slug: "market-hours",
    term: "Market hours",
    aliases: ["trading hours", "pre-market", "after-hours"],
    category,
    level: "beginner",
    requires: ["exchange"],
    oneLiner:
      "US regular trading runs 9:30am to 4:00pm Eastern on weekdays, with thinner sessions either side.",
    body: `The regular US session is 9:30am to 4:00pm Eastern, Monday to Friday, excluding market holidays. Closing prices, and most of the numbers you see quoted, come from this window.

Pre-market and after-hours sessions extend trading either side of it. These sessions are thin: fewer participants, wider [spreads](/learn/bid-ask-spread), and prices that can move dramatically on small volume. Most earnings announcements land here deliberately, so the market has time to digest them before regular trading resumes.

An after-hours price is a real price, but it is a much weaker signal than a regular-session one. It is common for a stock to move 8% after hours and open the next morning up 2%.`,
  },
];
