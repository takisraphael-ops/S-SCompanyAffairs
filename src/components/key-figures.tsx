import { MetricLabel } from "@/components/metric-label";
import { formatMetricValue } from "@/lib/derive";
import { METRIC_GROUPS } from "@/lib/metrics";
import type { PeriodSnapshot } from "@/services/fundamentals";

/**
 * Reported and derived figures for the latest period.
 *
 * Every label goes through <MetricLabel>, so each number explains itself
 * without this component knowing anything about concepts — the mapping lives
 * in `concept_metrics`. That is the mechanism P1 built paying off: this file
 * contains no explanation logic at all, and adding a metric to METRIC_GROUPS
 * is enough to make it explainable.
 */
export async function KeyFigures({
  snapshot,
}: {
  snapshot: PeriodSnapshot | null;
}) {
  if (!snapshot) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-8 text-center dark:border-neutral-700">
        <p className="text-sm text-neutral-500">
          No financials stored yet. Run{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
            npm run ingest:company
          </code>
          .
        </p>
      </div>
    );
  }

  const byKey = new Map(snapshot.metrics.map((m) => [m.metricKey, m]));

  const groups = METRIC_GROUPS.map((group) => ({
    title: group.title,
    rows: group.keys
      .map((key) => byKey.get(key))
      .filter((m): m is NonNullable<typeof m> => !!m),
  })).filter((g) => g.rows.length > 0);

  if (groups.length === 0) return null;

  const periodLabel = snapshot.periodEnd.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div>
      <p className="mb-4 text-xs text-neutral-400">
        {snapshot.periodType === "annual" ? "Full year" : "Quarter"} to{" "}
        {periodLabel}. Figures marked{" "}
        <span className="italic">derived</span> are calculated from the
        reported ones, not filed.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title}>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {group.title}
            </h4>
            <dl className="space-y-1.5">
              {group.rows.map((metric) => (
                <div
                  key={metric.metricKey}
                  className="flex items-baseline justify-between gap-3 border-b border-neutral-100 pb-1.5 last:border-0 dark:border-neutral-900"
                >
                  <dt className="text-sm text-neutral-600 dark:text-neutral-400">
                    <MetricLabel metricKey={metric.metricKey} />
                    {metric.origin === "derived" && (
                      <span
                        className="ml-1.5 text-[10px] italic text-neutral-400"
                        title="Calculated by this app from reported figures"
                      >
                        derived
                      </span>
                    )}
                  </dt>
                  <dd className="tnum shrink-0 text-sm font-medium">
                    {formatMetricValue(metric.value, metric.unit)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
