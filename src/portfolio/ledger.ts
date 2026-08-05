import type { CostBasisMethod, TransactionKind } from "@/db/schema";
import * as D from "@/lib/decimal";
import type { Dec } from "@/lib/decimal";

/**
 * The ledger engine: replaying transactions into positions.
 *
 * Everything here is a pure function of the transaction list, the corporate
 * actions, and a current price. Nothing is stored. That is the whole design:
 * a saved position is a second copy of the truth, and it goes wrong the first
 * time a backdated correction or a split arrives.
 *
 * All arithmetic goes through src/lib/decimal — see the note there on why
 * floats are not an option for cost basis.
 */

export interface LedgerTransaction {
  id: string;
  securityId: string;
  kind: TransactionKind;
  tradeDate: Date;
  /** As transacted, before any split adjustment. */
  quantity: Dec;
  price: Dec;
  fees: Dec;
  /** Tie-breaker for same-day trades; entry order. */
  sequence: number;
}

export interface LedgerCorporateAction {
  securityId: string;
  exDate: Date;
  /** New shares per old share. 4 for a 4-for-1; 0.1 for a 1-for-10 reverse. */
  ratio: Dec;
}

/** One purchase, split-adjusted, with whatever remains unsold. */
export interface Lot {
  transactionId: string;
  acquiredAt: Date;
  /** Shares still held from this lot. */
  quantity: Dec;
  /** Cost per share, including the fees paid to acquire it. */
  costPerShare: Dec;
}

export interface RealizedSale {
  transactionId: string;
  soldAt: Date;
  quantity: Dec;
  proceeds: Dec;
  costBasis: Dec;
  gain: Dec;
}

export interface Position {
  securityId: string;
  /** Split-adjusted shares held. */
  quantity: Dec;
  /** Total remaining cost, including acquisition fees. */
  costBasis: Dec;
  /** costBasis / quantity, or zero when flat. */
  averageCost: Dec;
  marketValue: Dec;
  unrealizedGain: Dec;
  /** Percentage, or null when there is no basis to measure against. */
  unrealizedGainPct: Dec | null;
  realizedGain: Dec;
  dividendIncome: Dec;
  /** Realised plus unrealised plus dividends. */
  totalReturn: Dec;
  /** Total return as a percentage of everything invested. */
  totalReturnPct: Dec | null;
  openLots: Lot[];
  sales: RealizedSale[];
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/**
 * Cumulative split factor to apply to a transaction dated `at`.
 *
 * Only actions after the trade matter: a purchase made before a 4-for-1 split
 * became four times as many shares at a quarter the price, while one made
 * after is already in post-split terms. Multiple splits compound.
 */
function splitFactorAfter(at: Date, actions: LedgerCorporateAction[]): Dec {
  let factor = D.fromString("1");
  for (const action of actions) {
    if (action.exDate.getTime() > at.getTime()) {
      factor = D.mul(factor, action.ratio);
    }
  }
  return factor;
}

/** A buy or transfer in adds shares; a sell or transfer out removes them. */
function isAcquisition(kind: TransactionKind): boolean {
  return kind === "buy" || kind === "transfer_in";
}

function isDisposal(kind: TransactionKind): boolean {
  return kind === "sell" || kind === "transfer_out";
}

/**
 * Consume `quantity` shares from open lots, returning the cost removed.
 *
 * FIFO takes from the oldest lot first. Average cost pools everything, so it
 * takes proportionally from all of them and the ordering does not matter.
 * The two produce different realised gains from identical trades, which is
 * exactly why the method is recorded per account rather than assumed.
 */
function consumeLots(
  lots: Lot[],
  quantity: Dec,
  method: CostBasisMethod,
): Dec {
  let remaining = quantity;
  let costRemoved = D.ZERO;

  if (method === "average") {
    const totalQuantity = D.sum(lots.map((l) => l.quantity));
    if (D.isZero(totalQuantity)) return D.ZERO;

    const totalCost = D.sum(lots.map((l) => D.mul(l.quantity, l.costPerShare)));
    const avg = D.div(totalCost, totalQuantity);

    costRemoved = D.mul(quantity, avg);

    // Reduce every lot proportionally so the pool stays consistent.
    const keepFraction = D.div(D.sub(totalQuantity, quantity), totalQuantity);
    for (const lot of lots) {
      lot.quantity = D.mul(lot.quantity, keepFraction);
      lot.costPerShare = avg;
    }
    return costRemoved;
  }

  // FIFO.
  for (const lot of lots) {
    if (D.isZero(remaining)) break;
    if (D.isZero(lot.quantity)) continue;

    const taken = D.min(lot.quantity, remaining);
    costRemoved = D.add(costRemoved, D.mul(taken, lot.costPerShare));
    lot.quantity = D.sub(lot.quantity, taken);
    remaining = D.sub(remaining, taken);
  }

  return costRemoved;
}

export interface BuildPositionOptions {
  method: CostBasisMethod;
  /** Latest price, split-adjusted terms. Null when no quote is stored. */
  price?: Dec | null;
}

/**
 * Replay one security's transactions into a position.
 *
 * Transactions must all concern the same security; corporate actions are
 * filtered to it.
 */
export function buildPosition(
  securityId: string,
  transactions: LedgerTransaction[],
  actions: LedgerCorporateAction[],
  options: BuildPositionOptions,
): Position {
  const relevantActions = actions.filter((a) => a.securityId === securityId);

  const ordered = [...transactions]
    .filter((t) => t.securityId === securityId)
    .sort(
      (a, b) =>
        a.tradeDate.getTime() - b.tradeDate.getTime() ||
        a.sequence - b.sequence,
    );

  const lots: Lot[] = [];
  const sales: RealizedSale[] = [];
  let realizedGain = D.ZERO;
  let dividendIncome = D.ZERO;
  /** Everything ever put in, for the return denominator. */
  let totalInvested = D.ZERO;

  for (const tx of ordered) {
    const factor = splitFactorAfter(tx.tradeDate, relevantActions);
    // Shares multiply by the split factor and the price per share divides by
    // it, so the total consideration is unchanged — which is the point: a
    // split transfers no value.
    const adjustedQuantity = D.mul(tx.quantity, factor);
    const adjustedPrice = D.div(tx.price, factor);

    if (tx.kind === "dividend") {
      // Dividends are recorded per share; the amount received is quantity
      // times the per-share payment. They are income, not a change in basis.
      dividendIncome = D.add(
        dividendIncome,
        D.sub(D.mul(tx.quantity, tx.price), tx.fees),
      );
      continue;
    }

    if (isAcquisition(tx.kind)) {
      const consideration = D.mul(adjustedQuantity, adjustedPrice);
      // Fees paid to acquire are part of what the shares cost you.
      const cost = D.add(consideration, tx.fees);
      totalInvested = D.add(totalInvested, cost);

      lots.push({
        transactionId: tx.id,
        acquiredAt: tx.tradeDate,
        quantity: adjustedQuantity,
        costPerShare: D.isZero(adjustedQuantity)
          ? D.ZERO
          : D.div(cost, adjustedQuantity),
      });
      continue;
    }

    if (isDisposal(tx.kind)) {
      const held = D.sum(lots.map((l) => l.quantity));
      if (D.cmp(adjustedQuantity, held) > 0) {
        throw new LedgerError(
          `sale of ${D.toString(adjustedQuantity)} shares on ` +
            `${tx.tradeDate.toISOString().slice(0, 10)} exceeds the ` +
            `${D.toString(held)} held at that point`,
        );
      }

      const costBasis = consumeLots(lots, adjustedQuantity, options.method);
      // Fees on a sale reduce what you actually received.
      const proceeds = D.sub(
        D.mul(adjustedQuantity, adjustedPrice),
        tx.fees,
      );
      const gain = D.sub(proceeds, costBasis);

      realizedGain = D.add(realizedGain, gain);
      sales.push({
        transactionId: tx.id,
        soldAt: tx.tradeDate,
        quantity: adjustedQuantity,
        proceeds,
        costBasis,
        gain,
      });
    }
  }

  const openLots = lots.filter((l) => D.cmp(l.quantity, D.ZERO) > 0);
  const quantity = D.sum(openLots.map((l) => l.quantity));
  const costBasis = D.sum(
    openLots.map((l) => D.mul(l.quantity, l.costPerShare)),
  );
  const averageCost = D.isZero(quantity) ? D.ZERO : D.div(costBasis, quantity);

  const price = options.price ?? null;
  const marketValue = price === null ? D.ZERO : D.mul(quantity, price);
  const unrealizedGain =
    price === null ? D.ZERO : D.sub(marketValue, costBasis);
  const unrealizedGainPct =
    price === null || D.isZero(costBasis)
      ? null
      : D.mul(D.div(unrealizedGain, costBasis), D.fromString("100"));

  const totalReturn = D.add(
    D.add(realizedGain, unrealizedGain),
    dividendIncome,
  );
  const totalReturnPct = D.isZero(totalInvested)
    ? null
    : D.mul(D.div(totalReturn, totalInvested), D.fromString("100"));

  return {
    securityId,
    quantity,
    costBasis,
    averageCost,
    marketValue,
    unrealizedGain,
    unrealizedGainPct,
    realizedGain,
    dividendIncome,
    totalReturn,
    totalReturnPct,
    openLots,
    sales,
  };
}

export interface PortfolioTotals {
  costBasis: Dec;
  marketValue: Dec;
  unrealizedGain: Dec;
  realizedGain: Dec;
  dividendIncome: Dec;
  totalReturn: Dec;
  unrealizedGainPct: Dec | null;
}

export function summarize(positions: Position[]): PortfolioTotals {
  const costBasis = D.sum(positions.map((p) => p.costBasis));
  const marketValue = D.sum(positions.map((p) => p.marketValue));
  const unrealizedGain = D.sum(positions.map((p) => p.unrealizedGain));
  const realizedGain = D.sum(positions.map((p) => p.realizedGain));
  const dividendIncome = D.sum(positions.map((p) => p.dividendIncome));

  return {
    costBasis,
    marketValue,
    unrealizedGain,
    realizedGain,
    dividendIncome,
    totalReturn: D.add(D.add(realizedGain, unrealizedGain), dividendIncome),
    unrealizedGainPct: D.isZero(costBasis)
      ? null
      : D.mul(D.div(unrealizedGain, costBasis), D.fromString("100")),
  };
}

/** Each position's share of total market value, as a percentage. */
export function positionWeight(
  position: Position,
  totals: PortfolioTotals,
): Dec | null {
  if (D.isZero(totals.marketValue)) return null;
  return D.mul(
    D.div(position.marketValue, totals.marketValue),
    D.fromString("100"),
  );
}
