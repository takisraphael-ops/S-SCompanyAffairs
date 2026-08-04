import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as D from "@/lib/decimal";
import {
  LedgerError,
  buildPosition,
  positionWeight,
  summarize,
  type LedgerCorporateAction,
  type LedgerTransaction,
} from "./ledger";

const SEC = "sec-1";
const d = D.fromString;
const s = D.toString;

let sequence = 0;
function tx(
  kind: LedgerTransaction["kind"],
  date: string,
  quantity: string,
  price: string,
  fees = "0",
): LedgerTransaction {
  return {
    id: `tx-${++sequence}`,
    securityId: SEC,
    kind,
    tradeDate: new Date(`${date}T00:00:00Z`),
    quantity: d(quantity),
    price: d(price),
    fees: d(fees),
    sequence,
  };
}

function split(date: string, ratio: string): LedgerCorporateAction {
  return { securityId: SEC, exDate: new Date(`${date}T00:00:00Z`), ratio: d(ratio) };
}

function build(
  transactions: LedgerTransaction[],
  opts: { method?: "fifo" | "average"; price?: string | null; actions?: LedgerCorporateAction[] } = {},
) {
  return buildPosition(SEC, transactions, opts.actions ?? [], {
    method: opts.method ?? "fifo",
    price: opts.price === undefined ? null : opts.price === null ? null : d(opts.price),
  });
}

describe("ledger — basic position", () => {
  it("accumulates quantity and cost from buys", () => {
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("buy", "2024-02-10", "50", "60"),
    ]);
    assert.equal(s(p.quantity), "150");
    assert.equal(s(p.costBasis), "8000"); // 5000 + 3000
    assert.equal(s(p.averageCost), "53.33333333");
  });

  it("includes acquisition fees in the cost basis", () => {
    const p = build([tx("buy", "2024-01-10", "100", "50", "9.95")]);
    assert.equal(s(p.costBasis), "5009.95");
    assert.equal(s(p.averageCost), "50.0995");
  });

  it("values the position at the current price", () => {
    const p = build([tx("buy", "2024-01-10", "100", "50")], { price: "75" });
    assert.equal(s(p.marketValue), "7500");
    assert.equal(s(p.unrealizedGain), "2500");
    assert.equal(s(p.unrealizedGainPct!), "50");
  });

  it("reports no market value when there is no quote", () => {
    const p = build([tx("buy", "2024-01-10", "100", "50")], { price: null });
    assert.equal(s(p.marketValue), "0");
    assert.equal(p.unrealizedGainPct, null);
  });

  it("handles an empty ledger", () => {
    const p = build([]);
    assert.equal(s(p.quantity), "0");
    assert.equal(s(p.costBasis), "0");
    assert.equal(p.unrealizedGainPct, null);
  });
});

describe("ledger — FIFO", () => {
  it("sells the oldest shares first", () => {
    // Buy 100 @ 50, buy 100 @ 70, sell 100 @ 90.
    // FIFO sells the $50 lot: proceeds 9000, basis 5000, gain 4000.
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("buy", "2024-02-10", "100", "70"),
      tx("sell", "2024-03-10", "100", "90"),
    ]);
    assert.equal(s(p.realizedGain), "4000");
    assert.equal(s(p.quantity), "100");
    assert.equal(s(p.costBasis), "7000", "the $70 lot remains");
  });

  it("spans multiple lots when a sale is larger than the first", () => {
    // Sell 150: all of the $50 lot (100) plus 50 of the $70 lot.
    // Basis 5000 + 3500 = 8500; proceeds 13500; gain 5000.
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("buy", "2024-02-10", "100", "70"),
      tx("sell", "2024-03-10", "150", "90"),
    ]);
    assert.equal(s(p.realizedGain), "5000");
    assert.equal(s(p.quantity), "50");
    assert.equal(s(p.costBasis), "3500");
  });

  it("subtracts selling fees from proceeds", () => {
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("sell", "2024-03-10", "100", "60", "9.95"),
    ]);
    assert.equal(s(p.realizedGain), "990.05"); // 6000 - 9.95 - 5000
  });

  it("records a realised loss as negative", () => {
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("sell", "2024-03-10", "100", "40"),
    ]);
    assert.equal(s(p.realizedGain), "-1000");
  });

  it("leaves the position flat when everything is sold", () => {
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("sell", "2024-03-10", "100", "60"),
    ]);
    assert.equal(s(p.quantity), "0");
    assert.equal(s(p.costBasis), "0");
    assert.equal(p.openLots.length, 0);
  });
});

describe("ledger — average cost", () => {
  it("pools every purchase into one blended basis", () => {
    // Same trades as the FIFO case. Average basis is (5000+7000)/200 = 60,
    // so selling 100 @ 90 realises 3000, not 4000.
    const p = build(
      [
        tx("buy", "2024-01-10", "100", "50"),
        tx("buy", "2024-02-10", "100", "70"),
        tx("sell", "2024-03-10", "100", "90"),
      ],
      { method: "average" },
    );
    assert.equal(s(p.realizedGain), "3000");
    assert.equal(s(p.averageCost), "60");
  });

  it("produces a different realised gain from FIFO on identical trades", () => {
    const trades = [
      tx("buy", "2024-01-10", "100", "50"),
      tx("buy", "2024-02-10", "100", "70"),
      tx("sell", "2024-03-10", "100", "90"),
    ];
    const fifo = buildPosition(SEC, trades, [], { method: "fifo", price: d("90") });
    const average = buildPosition(SEC, trades, [], { method: "average", price: d("90") });

    assert.notEqual(s(fifo.realizedGain), s(average.realizedGain));
    assert.notEqual(s(fifo.costBasis), s(average.costBasis));
  });

  it("leaves total return unchanged by the choice of method", () => {
    /*
     * The invariant worth pinning. The method decides which shares are
     * treated as sold, which moves value between the realised and unrealised
     * buckets — and therefore the tax bill — but it cannot change how much
     * you are actually up. Anything else would mean the accounting convention
     * created or destroyed money.
     */
    const trades = [
      tx("buy", "2024-01-10", "100", "50"),
      tx("buy", "2024-02-10", "100", "70"),
      tx("sell", "2024-03-10", "100", "90"),
    ];
    const fifo = buildPosition(SEC, trades, [], { method: "fifo", price: d("85") });
    const average = buildPosition(SEC, trades, [], { method: "average", price: d("85") });

    assert.equal(s(fifo.totalReturn), s(average.totalReturn));
    assert.equal(s(fifo.totalReturnPct!), s(average.totalReturnPct!));
    // Consumed plus remaining basis is the total invested either way.
    assert.equal(
      s(D.add(fifo.costBasis, D.sum(fifo.sales.map((x) => x.costBasis)))),
      s(D.add(average.costBasis, D.sum(average.sales.map((x) => x.costBasis)))),
    );
  });
});

describe("ledger — corporate actions", () => {
  it("adjusts a purchase made before a split", () => {
    // 100 shares at $500, then 4-for-1: 400 shares at $125. Same total cost.
    const p = build([tx("buy", "2024-01-10", "100", "500")], {
      actions: [split("2024-06-01", "4")],
      price: "125",
    });
    assert.equal(s(p.quantity), "400");
    assert.equal(s(p.costBasis), "50000", "a split transfers no value");
    assert.equal(s(p.averageCost), "125");
    assert.equal(s(p.unrealizedGain), "0", "not a 75% loss");
  });

  it("leaves a purchase made after the split alone", () => {
    const p = build([tx("buy", "2024-07-10", "400", "125")], {
      actions: [split("2024-06-01", "4")],
    });
    assert.equal(s(p.quantity), "400");
    assert.equal(s(p.costBasis), "50000");
  });

  it("compounds successive splits", () => {
    // 2-for-1 then 3-for-1 leaves six times the shares.
    const p = build([tx("buy", "2024-01-10", "100", "600")], {
      actions: [split("2024-03-01", "2"), split("2024-09-01", "3")],
    });
    assert.equal(s(p.quantity), "600");
    assert.equal(s(p.costBasis), "60000");
    assert.equal(s(p.averageCost), "100");
  });

  it("handles a reverse split", () => {
    // 1-for-10: 1000 shares at $0.50 become 100 at $5.
    const p = build([tx("buy", "2024-01-10", "1000", "0.5")], {
      actions: [split("2024-06-01", "0.1")],
    });
    assert.equal(s(p.quantity), "100");
    assert.equal(s(p.costBasis), "500");
    assert.equal(s(p.averageCost), "5");
  });

  it("computes the right realised gain across a split", () => {
    // Buy 100 @ $500 pre-split, 4-for-1, then sell 200 (half the adjusted
    // 400) at $150. Adjusted basis $125/share, so gain is 200 * 25 = 5000.
    const p = build(
      [
        tx("buy", "2024-01-10", "100", "500"),
        tx("sell", "2024-07-10", "200", "150"),
      ],
      { actions: [split("2024-06-01", "4")] },
    );
    assert.equal(s(p.realizedGain), "5000");
    assert.equal(s(p.quantity), "200");
  });

  it("ignores actions for other securities", () => {
    const p = build([tx("buy", "2024-01-10", "100", "500")], {
      actions: [{ securityId: "other", exDate: new Date("2024-06-01"), ratio: d("4") }],
    });
    assert.equal(s(p.quantity), "100");
  });
});

describe("ledger — dividends", () => {
  it("counts dividend income without touching the basis", () => {
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("dividend", "2024-03-15", "100", "0.24"),
    ]);
    assert.equal(s(p.dividendIncome), "24");
    assert.equal(s(p.costBasis), "5000", "dividends do not change what shares cost");
    assert.equal(s(p.quantity), "100");
  });

  it("nets withholding recorded as a fee", () => {
    const p = build([
      tx("buy", "2024-01-10", "100", "50"),
      tx("dividend", "2024-03-15", "100", "1", "15"),
    ]);
    assert.equal(s(p.dividendIncome), "85");
  });
});

describe("ledger — total return", () => {
  it("combines realised, unrealised and dividends", () => {
    // Buy 200 @ 50 (10000). Sell 100 @ 70 -> realised 2000.
    // Dividend 100 * 1 -> 100. Remaining 100 @ 90 -> unrealised 4000.
    const p = build(
      [
        tx("buy", "2024-01-10", "200", "50"),
        tx("sell", "2024-03-10", "100", "70"),
        tx("dividend", "2024-04-10", "100", "1"),
      ],
      { price: "90" },
    );
    assert.equal(s(p.realizedGain), "2000");
    assert.equal(s(p.unrealizedGain), "4000");
    assert.equal(s(p.dividendIncome), "100");
    assert.equal(s(p.totalReturn), "6100");
    assert.equal(s(p.totalReturnPct!), "61", "against the 10000 invested");
  });

  it("total return exceeds price return when dividends are paid", () => {
    const withDividend = build(
      [
        tx("buy", "2024-01-10", "100", "50"),
        tx("dividend", "2024-04-10", "100", "2"),
      ],
      { price: "55" },
    );
    assert.equal(s(withDividend.unrealizedGain), "500", "price return alone");
    assert.equal(s(withDividend.totalReturn), "700", "plus 200 of dividends");
  });
});

describe("ledger — invalid ledgers", () => {
  it("refuses to sell more than is held", () => {
    assert.throws(
      () =>
        build([
          tx("buy", "2024-01-10", "100", "50"),
          tx("sell", "2024-03-10", "150", "60"),
        ]),
      (err: Error) => {
        assert.ok(err instanceof LedgerError);
        assert.match(err.message, /exceeds the 100 held/);
        return true;
      },
    );
  });

  it("checks holdings as at the sale date, not the end state", () => {
    // Selling 100 before the second purchase must fail even though 200 are
    // eventually bought — the ledger is replayed in order.
    assert.throws(
      () =>
        build([
          tx("buy", "2024-01-10", "50", "50"),
          tx("sell", "2024-02-10", "100", "60"),
          tx("buy", "2024-03-10", "150", "55"),
        ]),
      LedgerError,
    );
  });

  it("replays out-of-order input by trade date", () => {
    const later = tx("sell", "2024-03-10", "100", "90");
    const earlier = tx("buy", "2024-01-10", "100", "50");
    const p = build([later, earlier]);
    assert.equal(s(p.realizedGain), "4000");
  });
});

describe("ledger — portfolio totals", () => {
  it("sums positions and computes weights", () => {
    const a = buildPosition("a", [{ ...tx("buy", "2024-01-10", "100", "50"), securityId: "a" }], [], {
      method: "fifo",
      price: d("60"),
    });
    const b = buildPosition("b", [{ ...tx("buy", "2024-01-10", "100", "20"), securityId: "b" }], [], {
      method: "fifo",
      price: d("20"),
    });

    const totals = summarize([a, b]);
    assert.equal(s(totals.costBasis), "7000");
    assert.equal(s(totals.marketValue), "8000");
    assert.equal(s(totals.unrealizedGain), "1000");

    assert.equal(s(positionWeight(a, totals)!), "75");
    assert.equal(s(positionWeight(b, totals)!), "25");
  });

  it("weights sum to 100", () => {
    const positions = ["a", "b", "c"].map((id, i) =>
      buildPosition(id, [{ ...tx("buy", "2024-01-10", "10", `${(i + 1) * 7}`), securityId: id }], [], {
        method: "fifo",
        price: d(`${(i + 1) * 7}`),
      }),
    );
    const totals = summarize(positions);
    const sum = D.sum(positions.map((p) => positionWeight(p, totals)!));
    assert.equal(s(D.round(sum, 6)), "100");
  });

  it("returns no weight when nothing is held", () => {
    const empty = buildPosition("a", [], [], { method: "fifo" });
    assert.equal(positionWeight(empty, summarize([empty])), null);
  });
});

describe("ledger — exactness end to end", () => {
  it("does not accumulate rounding error over many trades", () => {
    // 100 buys of 3 shares at 19.99, then sell everything at the same price.
    // The realised gain must be exactly zero, not 0.0000001.
    const trades: LedgerTransaction[] = [];
    for (let i = 0; i < 100; i++) {
      trades.push(tx("buy", "2024-01-10", "3", "19.99"));
    }
    trades.push(tx("sell", "2024-06-10", "300", "19.99"));

    const p = build(trades);
    assert.equal(s(p.realizedGain), "0");
    assert.equal(s(p.quantity), "0");
  });

  it("keeps fractional shares exact", () => {
    const p = build([
      tx("buy", "2024-01-10", "0.33333333", "300"),
      tx("buy", "2024-02-10", "0.66666667", "300"),
    ]);
    assert.equal(s(p.quantity), "1");
    assert.equal(s(p.costBasis), "300");
  });
});
