import { getConceptIndex, getUserLevel } from "@/services/concepts";
import { TermPopover } from "./term-popover";

/**
 * Renders the label for a displayed metric, explained automatically.
 *
 *   <MetricLabel metricKey="change_pct">Change</MetricLabel>
 *
 * The caller names a metric, not a concept — the `concept_metrics` mapping
 * supplies the explanation. This is the mechanism that keeps "explain every
 * number" tractable: a metric added to the ingest pipeline becomes
 * explainable the moment someone writes its concept, with no UI change, and
 * `npm run concepts:coverage` fails on any rendered metric that lacks one.
 */
export async function MetricLabel({
  metricKey,
  children,
}: {
  metricKey: string;
  children?: React.ReactNode;
}) {
  const [index, level] = await Promise.all([getConceptIndex(), getUserLevel()]);
  const concept = index.byMetric.get(metricKey);

  if (!concept) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`<MetricLabel>: no concept mapped to metric "${metricKey}"`);
    }
    return <>{children ?? metricKey}</>;
  }

  return (
    <TermPopover
      slug={concept.slug}
      term={concept.term}
      oneLiner={concept.oneLiner}
      level={concept.level}
      emphasis={level === "beginner" ? "clear" : "subtle"}
    >
      {children ?? concept.term}
    </TermPopover>
  );
}
