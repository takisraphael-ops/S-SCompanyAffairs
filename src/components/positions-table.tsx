import Link from "next/link";
import { MetricLabel } from "@/components/metric-label";
import * as D from "@/lib/decimal";
import { formatCurrency, formatSignedCurrency } from "@/lib/derive";
import type { PositionView } from "@/services/portfolio";

function money(value: D.Dec): string {
  return formatCurrency(D.toNumber(value));
}

function signedMoney(value: D.Dec): string {
  return formatSignedCurrency(D.toNumber(value));
}

function tone(value: D.Dec): string {
  const c = D.cmp(value, D.ZERO);
  return c > 0 ? "text-up" : c < 0 ? "text-down" : "text-neutral-500";
}

/**
 * Holdings, with every column heading explained.
 *
 * Same mechanism as the watchlist and the company page: headings go through
 * <MetricLabel>, which resolves the explanation from `concept_metrics`. This
 * component knows nothing about concepts.
 */
export async function PositionsTable({
  positions,
}: {
  positions: PositionView[];
}) {
  const open = positions.filter((p) => D.cmp(p.quantity, D.ZERO) > 0);
  const closed = positions.filter((p) => D.cmp(p.quantity, D.ZERO) === 0);

  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
        <p className="text-sm font-medium">No holdings recorded yet.</p>
        <p className="mt-1 text-sm text-neutral-500">
          Record a buy above. Positions are rebuilt from the transaction log
          every time this page loads, so corrections take effect immediately.
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            <th scope="col" className="py-2 pr-4 font-medium">
              Symbol
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              <MetricLabel metricKey="quantity">Shares</MetricLabel>
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              <MetricLabel metricKey="cost_basis">Cost</MetricLabel>
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              <MetricLabel metricKey="market_value">Value</MetricLabel>
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              <MetricLabel metricKey="unrealized_gain">Unrealised</MetricLabel>
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              <MetricLabel metricKey="realized_gain">Realised</MetricLabel>
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              <MetricLabel metricKey="position_weight">Weight</MetricLabel>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...open, ...closed].map((position) => {
            const isClosed = D.cmp(position.quantity, D.ZERO) === 0;

            return (
              <tr
                key={position.securityId}
                className={`border-b border-neutral-100 last:border-0 dark:border-neutral-900 ${
                  isClosed ? "opacity-60" : ""
                }`}
              >
                <td className="py-3 pr-4 font-medium">
                  <Link
                    href={`/company/${position.ticker}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {position.ticker}
                  </Link>
                  {isClosed && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-neutral-400">
                      closed
                    </span>
                  )}
                </td>
                <td className="tnum py-3 pr-4 text-right">
                  {D.toString(D.round(position.quantity, 4))}
                </td>
                <td className="tnum py-3 pr-4 text-right">
                  {money(position.costBasis)}
                  <span className="ml-1 block text-[10px] text-neutral-400">
                    {isClosed ? "" : `@ ${D.toNumber(position.averageCost).toFixed(2)}`}
                  </span>
                </td>
                <td className="tnum py-3 pr-4 text-right">
                  {position.price === null ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    money(position.marketValue)
                  )}
                </td>
                <td
                  className={`tnum py-3 pr-4 text-right ${tone(position.unrealizedGain)}`}
                >
                  {position.price === null || isClosed ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    <>
                      {signedMoney(position.unrealizedGain)}
                      {position.unrealizedGainPct && (
                        <span className="ml-1 block text-[10px] opacity-80">
                          {D.toNumber(position.unrealizedGainPct) > 0 ? "+" : ""}
                          {D.toNumber(position.unrealizedGainPct).toFixed(1)}%
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td
                  className={`tnum py-3 pr-4 text-right ${tone(position.realizedGain)}`}
                >
                  {D.isZero(position.realizedGain) ? (
                    <span className="text-neutral-400">—</span>
                  ) : (
                    signedMoney(position.realizedGain)
                  )}
                </td>
                <td className="tnum py-3 text-right text-neutral-500">
                  {position.weight === null || isClosed
                    ? "—"
                    : `${D.toNumber(position.weight).toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
