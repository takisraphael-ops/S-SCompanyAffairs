import type { Metadata } from "next";
import { deleteTransactionAction } from "@/app/portfolio/actions";
import { MethodSwitcher } from "@/components/method-switcher";
import { PositionsTable } from "@/components/positions-table";
import { Term } from "@/components/term";
import { TransactionForm } from "@/components/transaction-form";
import * as D from "@/lib/decimal";
import { formatCurrency, formatSignedCurrency } from "@/lib/derive";
import { getPortfolio, listTransactions } from "@/services/portfolio";
import { listWatchlist } from "@/services/watchlist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio · S&S Company Affairs",
  description: "What you own, what it cost, and how it has done.",
};

function Stat({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  tone?: "up" | "down" | null;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`tnum mt-1 text-lg font-semibold ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function toneOf(value: D.Dec): "up" | "down" | null {
  const c = D.cmp(value, D.ZERO);
  return c > 0 ? "up" : c < 0 ? "down" : null;
}

function signed(value: D.Dec): string {
  return formatSignedCurrency(D.toNumber(value));
}

export default async function PortfolioPage() {
  const [portfolio, transactions, watchlist] = await Promise.all([
    getPortfolio(),
    listTransactions(50),
    listWatchlist(),
  ]);

  const { totals, account } = portfolio;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Portfolio</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Rebuilt from your transaction log on every load. Splits are applied
            when the ledger is read, so history stays as it happened.
          </p>
        </div>
        <MethodSwitcher current={account.costBasisMethod} />
      </div>

      {portfolio.error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-down/40 bg-down/5 p-3 text-sm text-down"
        >
          <strong className="font-medium">Ledger problem:</strong>{" "}
          {portfolio.error}
        </div>
      )}

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={<Term slug="market-value">Value</Term>}
          value={formatCurrency(D.toNumber(totals.marketValue))}
        />
        <Stat
          label={<Term slug="cost-basis">Cost</Term>}
          value={formatCurrency(D.toNumber(totals.costBasis))}
        />
        <Stat
          label={<Term slug="unrealized-gain">Unrealised</Term>}
          value={signed(totals.unrealizedGain)}
          tone={toneOf(totals.unrealizedGain)}
        />
        <Stat
          label={<Term slug="realized-gain">Realised</Term>}
          value={signed(totals.realizedGain)}
          tone={toneOf(totals.realizedGain)}
        />
        <Stat
          label={<Term slug="total-return">Total return</Term>}
          value={signed(totals.totalReturn)}
          tone={toneOf(totals.totalReturn)}
        />
      </div>

      <section className="mb-10">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Holdings
        </h3>
        <PositionsTable positions={portfolio.positions} />
        {D.cmp(totals.dividendIncome, D.ZERO) > 0 && (
          <p className="mt-3 text-xs text-neutral-500">
            Includes {formatCurrency(D.toNumber(totals.dividendIncome))} of{" "}
            <Term slug="dividend">dividend income</Term>, counted in total
            return but not in unrealised gain.
          </p>
        )}
      </section>

      <section className="mb-10">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Record a transaction
        </h3>
        <p className="mb-3 text-xs text-neutral-400">
          For a dividend, enter the shares you held and the amount per share.
        </p>
        <TransactionForm tickers={watchlist.map((w) => w.ticker)} />
      </section>

      {transactions.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Ledger
          </h3>
          <div className="relative overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Symbol</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 text-right font-medium">Quantity</th>
                  <th className="py-2 pr-4 text-right font-medium">Price</th>
                  <th className="py-2 pr-4 text-right font-medium">Fees</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                  >
                    <td className="tnum py-2 pr-4 text-neutral-500">
                      {t.tradeDate.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2 pr-4 font-medium">{t.ticker}</td>
                    <td className="py-2 pr-4 capitalize text-neutral-600 dark:text-neutral-400">
                      {t.kind.replace("_", " ")}
                    </td>
                    <td className="tnum py-2 pr-4 text-right">
                      {D.toString(D.fromString(t.quantity))}
                    </td>
                    <td className="tnum py-2 pr-4 text-right">
                      {D.toNumber(D.fromString(t.price)).toFixed(2)}
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-neutral-500">
                      {D.isZero(D.fromString(t.fees))
                        ? "—"
                        : D.toNumber(D.fromString(t.fees)).toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      <form action={deleteTransactionAction}>
                        <input type="hidden" name="transactionId" value={t.id} />
                        <button
                          type="submit"
                          aria-label={`Delete ${t.kind} of ${t.ticker} on ${t.tradeDate.toISOString().slice(0, 10)}`}
                          className="rounded px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-100 hover:text-down dark:hover:bg-neutral-900"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
