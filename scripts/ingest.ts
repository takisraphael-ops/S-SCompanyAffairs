/**
 * Run the quote ingest from the command line.
 *
 *   npm run ingest
 *
 * Same code path as the cron route, minus the HTTP layer — useful for local
 * verification and for driving ingest from an external scheduler.
 */
import { closeDb } from "@/db";
import { ingestQuotes } from "@/ingest/quotes";
import { loadEnvFiles } from "@/lib/load-env";

loadEnvFiles();

async function main() {
  const result = await ingestQuotes();

  console.log(
    `[${result.job}] ${result.status}: ${result.ok} ok, ${result.failed} failed`,
  );
  for (const e of result.errors) {
    console.error(`  ${e.ticker}: ${e.message}`);
  }

  await closeDb();
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
