import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  accounts,
  corporateActions,
  quotesLatest,
  securities,
  transactions,
  type Account,
  type Transaction,
  type TransactionKind,
} from "@/db/schema";
import * as D from "@/lib/decimal";
import {
  LedgerError,
  buildPosition,
  positionWeight,
  summarize,
  type LedgerCorporateAction,
  type LedgerTransaction,
  type Position,
  type PortfolioTotals,
} from "@/portfolio/ledger";

/** Single-account default, matching the single-user assumption elsewhere. */
const DEFAULT_ACCOUNT_NAME = "Main";

export interface PositionView extends Position {
  ticker: string;
  name: string;
  price: D.Dec | null;
  /** Percentage of portfolio market value, or null when nothing is held. */
  weight: D.Dec | null;
}

export interface PortfolioView {
  account: Account;
  positions: PositionView[];
  totals: PortfolioTotals;
  /** Populated when the ledger is internally inconsistent. */
  error: string | null;
}

/**
 * Get the account, creating it on first use.
 *
 * Both the insert and the read are race-safe, because a single page render
 * calls this from several places concurrently. The unique index on `name`
 * makes a losing insert a no-op instead of a second account, and the ordered
 * read means every caller resolves to the same row even if one somehow
 * exists — an unordered `limit 1` is not deterministic in Postgres.
 */
export async function getOrCreateAccount(): Promise<Account> {
  const db = getDb();

  const first = async () =>
    (
      await db
        .select()
        .from(accounts)
        .orderBy(asc(accounts.createdAt), asc(accounts.id))
        .limit(1)
    )[0];

  const existing = await first();
  if (existing) return existing;

  await db
    .insert(accounts)
    .values({ name: DEFAULT_ACCOUNT_NAME })
    .onConflictDoNothing({ target: accounts.name });

  const created = await first();
  if (!created) throw new Error("could not create account");
  return created;
}

/**
 * Rebuild the whole portfolio from the ledger.
 *
 * Every read replays the transaction log rather than reading a stored
 * position, so a backdated correction or a newly recorded split is reflected
 * immediately and cannot leave a stale figure behind.
 */
export async function getPortfolio(): Promise<PortfolioView> {
  const db = getDb();
  const account = await getOrCreateAccount();

  const rows = await db
    .select({
      id: transactions.id,
      securityId: transactions.securityId,
      kind: transactions.kind,
      tradeDate: transactions.tradeDate,
      quantity: transactions.quantity,
      price: transactions.price,
      fees: transactions.fees,
      createdAt: transactions.createdAt,
      ticker: securities.ticker,
      name: securities.name,
    })
    .from(transactions)
    .innerJoin(securities, eq(transactions.securityId, securities.id))
    .where(eq(transactions.accountId, account.id))
    .orderBy(asc(transactions.tradeDate), asc(transactions.createdAt));

  if (rows.length === 0) {
    return {
      account,
      positions: [],
      totals: summarize([]),
      error: null,
    };
  }

  const securityIds = [...new Set(rows.map((r) => r.securityId))];

  const [actionRows, quoteRows] = await Promise.all([
    db
      .select()
      .from(corporateActions)
      .where(inArray(corporateActions.securityId, securityIds)),
    db
      .select({
        securityId: quotesLatest.securityId,
        price: quotesLatest.price,
      })
      .from(quotesLatest)
      .where(inArray(quotesLatest.securityId, securityIds)),
  ]);

  const priceBySecurity = new Map(
    quoteRows.map((q) => [q.securityId, D.fromString(q.price)]),
  );

  const ledgerTransactions: LedgerTransaction[] = rows.map((r, index) => ({
    id: r.id,
    securityId: r.securityId,
    kind: r.kind,
    tradeDate: r.tradeDate,
    quantity: D.fromString(r.quantity),
    price: D.fromString(r.price),
    fees: D.fromString(r.fees),
    // Entry order breaks ties between trades on the same date.
    sequence: index,
  }));

  const ledgerActions: LedgerCorporateAction[] = actionRows.map((a) => ({
    securityId: a.securityId,
    exDate: a.exDate,
    ratio: D.fromString(a.ratio),
  }));

  const meta = new Map(
    rows.map((r) => [r.securityId, { ticker: r.ticker, name: r.name }]),
  );

  let error: string | null = null;
  const positions: PositionView[] = [];

  for (const securityId of securityIds) {
    const price = priceBySecurity.get(securityId) ?? null;
    try {
      const position = buildPosition(
        securityId,
        ledgerTransactions,
        ledgerActions,
        { method: account.costBasisMethod, price },
      );
      const info = meta.get(securityId)!;
      positions.push({
        ...position,
        ticker: info.ticker,
        name: info.name,
        price,
        weight: null,
      });
    } catch (err) {
      // A bad ledger is a data problem the user must see and fix, not a crash.
      if (err instanceof LedgerError) {
        const info = meta.get(securityId);
        error = `${info?.ticker ?? securityId}: ${err.message}`;
        continue;
      }
      throw err;
    }
  }

  const totals = summarize(positions);
  for (const position of positions) {
    position.weight = positionWeight(position, totals);
  }

  // Largest holdings first; closed positions sink to the bottom.
  positions.sort((a, b) => D.cmp(b.marketValue, a.marketValue) || a.ticker.localeCompare(b.ticker));

  return { account, positions, totals, error };
}

export interface RecordTransactionInput {
  ticker: string;
  kind: TransactionKind;
  tradeDate: Date;
  quantity: string;
  price: string;
  fees?: string;
  notes?: string | null;
}

/**
 * Append to the ledger.
 *
 * Validated then replayed before committing: recording a sale of more shares
 * than are held would make every later figure for that holding unreadable, so
 * it is rejected at entry rather than discovered on the next page load.
 */
export async function recordTransaction(
  input: RecordTransactionInput,
): Promise<Transaction> {
  const db = getDb();
  const account = await getOrCreateAccount();

  const [security] = await db
    .select()
    .from(securities)
    .where(eq(securities.ticker, input.ticker.toUpperCase()))
    .limit(1);

  if (!security) {
    throw new LedgerError(
      `${input.ticker.toUpperCase()} is not tracked yet — add it to the watchlist first.`,
    );
  }

  const quantity = D.fromString(input.quantity);
  const price = D.fromString(input.price);
  const fees = D.fromString(input.fees?.trim() || "0");

  if (D.cmp(quantity, D.ZERO) <= 0) {
    throw new LedgerError("Quantity must be greater than zero.");
  }
  if (D.isNegative(price)) {
    throw new LedgerError("Price cannot be negative.");
  }
  if (D.isNegative(fees)) {
    throw new LedgerError("Fees cannot be negative.");
  }

  // Dry-run the ledger with the new entry appended.
  const existing = await db
    .select()
    .from(transactions)
    .where(eq(transactions.accountId, account.id))
    .orderBy(asc(transactions.tradeDate), asc(transactions.createdAt));

  const actionRows = await db
    .select()
    .from(corporateActions)
    .where(eq(corporateActions.securityId, security.id));

  const candidate: LedgerTransaction[] = [
    ...existing.map((t, i) => ({
      id: t.id,
      securityId: t.securityId,
      kind: t.kind,
      tradeDate: t.tradeDate,
      quantity: D.fromString(t.quantity),
      price: D.fromString(t.price),
      fees: D.fromString(t.fees),
      sequence: i,
    })),
    {
      id: "pending",
      securityId: security.id,
      kind: input.kind,
      tradeDate: input.tradeDate,
      quantity,
      price,
      fees,
      sequence: existing.length,
    },
  ];

  buildPosition(
    security.id,
    candidate,
    actionRows.map((a) => ({
      securityId: a.securityId,
      exDate: a.exDate,
      ratio: D.fromString(a.ratio),
    })),
    { method: account.costBasisMethod },
  );

  const [created] = await db
    .insert(transactions)
    .values({
      accountId: account.id,
      securityId: security.id,
      kind: input.kind,
      tradeDate: input.tradeDate,
      quantity: D.toDbString(quantity),
      price: D.toDbString(price),
      fees: D.toDbString(fees),
      notes: input.notes?.trim() || null,
    })
    .returning();

  if (!created) throw new Error("could not record transaction");
  return created;
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(transactions)
    .where(eq(transactions.id, id))
    .returning({ id: transactions.id });
  return deleted.length > 0;
}

export interface TransactionRow extends Transaction {
  ticker: string;
}

export async function listTransactions(limit = 100): Promise<TransactionRow[]> {
  const account = await getOrCreateAccount();

  const rows = await getDb()
    .select({
      transaction: transactions,
      ticker: securities.ticker,
    })
    .from(transactions)
    .innerJoin(securities, eq(transactions.securityId, securities.id))
    .where(eq(transactions.accountId, account.id))
    .orderBy(asc(transactions.tradeDate))
    .limit(limit);

  return rows
    .map((r) => ({ ...r.transaction, ticker: r.ticker }))
    .reverse();
}

export async function setCostBasisMethod(
  method: Account["costBasisMethod"],
): Promise<void> {
  const account = await getOrCreateAccount();
  await getDb()
    .update(accounts)
    .set({ costBasisMethod: method })
    .where(eq(accounts.id, account.id));
}

export { LedgerError };
