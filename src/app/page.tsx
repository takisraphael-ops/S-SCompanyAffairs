import Link from "next/link";
import { AddTickerForm } from "@/components/add-ticker-form";
import { RefreshButton } from "@/components/refresh-button";
import { Term } from "@/components/term";
import { WatchlistTable } from "@/components/watchlist-table";
import { formatRelativeTime } from "@/lib/format";
import { getUserLevel } from "@/services/concepts";
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
  const [rows, lastRun, level] = await Promise.all([
    listWatchlist(),
    getLastIngestRun(),
    getUserLevel(),
  ]);

  return (
    <div>
      {/*
        Progressive disclosure: the primer is scaffolding a beginner needs once
        and an experienced reader would find patronising. Terms stay explainable
        at every level; only the unprompted explanation is level-gated.
      */}
      {level === "beginner" && (
        <section className="mb-8 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-400">
          <p>
            Each row is one company. <Term slug="price">Last</Term> is the most
            recent price one share traded at, and{" "}
            <Term slug="percent-change">Change</Term> compares it to yesterday&apos;s{" "}
            <Term slug="previous-close">close</Term>. Any underlined word
            explains itself — hover it, or open{" "}
            <Link
              href="/learn"
              className="font-medium underline underline-offset-2 hover:opacity-70"
            >
              Learn
            </Link>{" "}
            to browse everything.
          </p>
        </section>
      )}

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
