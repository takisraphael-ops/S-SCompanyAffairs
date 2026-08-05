import Link from "next/link";
import { removeTickerAction } from "@/app/actions";
import { MetricLabel } from "@/components/metric-label";
import { Term } from "@/components/term";
import {
  direction,
  formatPrice,
  formatRelativeTime,
  formatSigned,
  formatSignedPct,
} from "@/lib/format";
import type { WatchlistRow } from "@/services/watchlist";

function ChangeCell({ row }: { row: WatchlistRow }) {
  const dir = direction(row.changePct);
  const tone =
    dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-neutral-500";

  return (
    <span className={`tnum ${tone}`}>
      {formatSigned(row.change)}{" "}
      <span className="text-xs opacity-80">
        ({formatSignedPct(row.changePct)})
      </span>
    </span>
  );
}

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
        <p className="text-sm font-medium">Nothing on the watchlist yet.</p>
        <p className="mt-1 text-sm text-neutral-500">
          Add a ticker above. Company name and SEC identifiers are resolved
          automatically from EDGAR.
        </p>
      </div>
    );
  }

  return (
    /*
     * `relative` is load-bearing: the `sr-only` header below is absolutely
     * positioned, and without a positioned ancestor its containing block is
     * the viewport, so it escapes this scroll container and drags the whole
     * page into horizontal scrolling on narrow screens.
     */
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            {/*
              Headers go through <Term>/<MetricLabel> rather than plain text.
              The metric variants resolve their explanation from the
              concept_metrics mapping, so a column added later is explainable
              as soon as its concept exists — no change needed here.
            */}
            <th scope="col" className="py-2 pr-4 font-medium">
              <Term slug="ticker">Symbol</Term>
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Company
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              <MetricLabel metricKey="price">Last</MetricLabel>
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              <MetricLabel metricKey="change_pct">Change</MetricLabel>
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Updated
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.watchlistItemId}
              className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
            >
              <td className="py-3 pr-4 font-medium">
                <Link
                  href={`/company/${row.ticker}`}
                  className="underline-offset-4 hover:underline"
                >
                  {row.ticker}
                </Link>
              </td>
              <td className="max-w-xs truncate py-3 pr-4 text-neutral-600 dark:text-neutral-400">
                {/*
                  `name` falls back to the ticker when neither EDGAR nor the
                  quote provider could identify the company. Repeating the
                  symbol reads as a rendering bug, so say what actually happened.
                */}
                {row.name === row.ticker ? (
                  <span className="italic text-neutral-400">
                    Name unresolved
                  </span>
                ) : (
                  row.name
                )}
                {row.exchange && (
                  <span className="ml-2 text-xs text-neutral-400">
                    {row.exchange}
                  </span>
                )}
              </td>
              <td className="tnum py-3 pr-4 text-right">
                {formatPrice(row.price)}
              </td>
              <td className="py-3 pr-4 text-right">
                {row.price === null ? (
                  <span className="text-neutral-400">—</span>
                ) : (
                  <ChangeCell row={row} />
                )}
              </td>
              <td className="py-3 pr-4 text-right text-xs text-neutral-500">
                {formatRelativeTime(row.fetchedAt)}
              </td>
              <td className="py-3 text-right">
                <form action={removeTickerAction}>
                  <input
                    type="hidden"
                    name="securityId"
                    value={row.securityId}
                  />
                  <button
                    type="submit"
                    aria-label={`Remove ${row.ticker} from watchlist`}
                    className="rounded px-2 py-1 text-xs text-neutral-400 transition hover:bg-neutral-100 hover:text-down dark:hover:bg-neutral-900"
                  >
                    Remove
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
