/**
 * Report which displayable metrics have no explanation.
 *
 *   npm run concepts:coverage
 *
 * Exits non-zero when a key in METRIC_KEYS — the metrics the UI can actually
 * render — lacks a concept. That is the guard that stops explanation coverage
 * rotting as later phases add fundamentals: adding a metric to the registry
 * without writing its concept breaks the build.
 *
 * Planned keys are reported for information only and do not fail.
 */
import { ALL_CONCEPTS } from "@/content/concepts";
import { METRIC_KEYS, PLANNED_METRIC_KEYS } from "@/lib/metrics";

const owners = new Map<string, string>();
for (const c of ALL_CONCEPTS) {
  for (const key of c.metrics ?? []) owners.set(key, c.slug);
}

const missing = METRIC_KEYS.filter((k) => !owners.has(k));
const missingPlanned = PLANNED_METRIC_KEYS.filter((k) => !owners.has(k));

console.log(
  `rendered metrics: ${METRIC_KEYS.length - missing.length}/${METRIC_KEYS.length} explained`,
);
console.log(
  `planned metrics:  ${PLANNED_METRIC_KEYS.length - missingPlanned.length}/${PLANNED_METRIC_KEYS.length} explained`,
);

if (missingPlanned.length) {
  console.log(`\nplanned but unexplained (not fatal):`);
  for (const k of missingPlanned) console.log(`  - ${k}`);
}

if (missing.length) {
  console.error(`\nMISSING explanations for rendered metrics:`);
  for (const k of missing) console.error(`  - ${k}`);
  process.exit(1);
}

console.log("\nall rendered metrics are explainable");
