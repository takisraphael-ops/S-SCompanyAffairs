/**
 * Run the fundamentals, filings and calendar ingest.
 *
 *   npm run ingest:company
 *
 * The slowest of the three jobs — SEC companyfacts documents carry every fact
 * a company has ever reported — so it is scheduled daily rather than intraday.
 */
import { closeDb } from "@/db";
import { ingestCompanyData } from "@/ingest/company";
import { loadEnvFiles } from "@/lib/load-env";

loadEnvFiles();

async function main() {
  const result = await ingestCompanyData();

  console.log(
    `[${result.job}] ${result.status}: ${result.fundamentals} facts, ` +
      `${result.filings} new filings, ${result.events} events, ${result.failed} failed`,
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
