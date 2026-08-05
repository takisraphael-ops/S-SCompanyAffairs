/**
 * Evaluate every enabled alert rule once.
 *
 *   npm run alerts
 *
 * Safe to re-run. A condition that is still true does not fire again, and a
 * firing already recorded is suppressed by its dedupe key — the counts below
 * distinguish the two, which is the quickest way to tell a working rule from
 * a stuck one.
 */
import { closeDb } from "@/db";
import { ingestAlerts } from "@/ingest/alerts";
import { loadEnvFiles } from "@/lib/load-env";

loadEnvFiles();

async function main() {
  const result = await ingestAlerts();

  console.log(
    `[${result.job}] ${result.status}: ${result.evaluated} evaluated, ` +
      `${result.fired} fired, ${result.suppressed} already known, ` +
      `${result.rearmed} re-armed, ${result.delivered} delivered, ` +
      `${result.failed} failed`,
  );

  for (const e of result.errors.slice(0, 20)) {
    console.error(`  ${e.target}: ${e.message}`);
  }

  await closeDb();
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
