import { AddTickerForm } from "@/components/add-ticker-form";
import { RefreshButton } from "@/components/refresh-button";
import { WatchlistTable } from "@/components/watchlist-table";
import { formatRelativeTime } from "@/lib/format";
import { getLastIngestRun } from "@/services/ingest-status";
import { listWatchlist } from "@/services/watchlist";

// Reads live rows from Postgres on every request.
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ok: "healthy",
  partial: "partial — some tickers failed",
  failed: "failed",
  running: "running",
};

export default async function Home() {
  const [rows, lastRun] = await Promise.all([
    listWatchlist(),
    getLastIngestRun(),
  ]);

  return (
    <div>
      <AddTickerForm />

      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-xs text-neutral-500">
          {lastRun ? (
            <>
              Last ingest {formatRelativeTime(lastRun.startedAt)} ·{" "}
              <span
                className={
                  lastRun.status === "failed"
                    ? "text-down"
                    : lastRun.status === "partial"
                      ? "text-neutral-600 dark:text-neutral-300"
                      : ""
                }
              >
                {STATUS_LABEL[lastRun.status] ?? lastRun.status}
              </span>
              {lastRun.itemsFailed > 0 && ` (${lastRun.itemsFailed} failed)`}
            </>
          ) : (
            "No ingest has run yet."
          )}
        </p>
        <RefreshButton />
      </div>

      <WatchlistTable rows={rows} />
    </div>
  );
}
