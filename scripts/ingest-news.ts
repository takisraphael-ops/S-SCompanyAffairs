/**
 * Run the news ingest from the command line.
 *
 *   npm run ingest:news
 *
 * Same code path as the cron route. Prints the dedup breakdown, which is the
 * quickest way to tell whether clustering is behaving.
 */
import { closeDb } from "@/db";
import { ingestNews } from "@/ingest/news";
import { loadEnvFiles } from "@/lib/load-env";
import { getLinkMethodStats } from "@/services/news";

loadEnvFiles();

async function main() {
  const result = await ingestNews();

  console.log(
    `[${result.job}] ${result.status}: fetched ${result.fetched}, ` +
      `${result.inserted} new stories, ${result.clustered} clustered into existing, ` +
      `${result.duplicateUrls} already seen, ${result.linked} links, ${result.failed} failed`,
  );

  for (const e of result.errors.slice(0, 20)) {
    console.error(`  ${e.target}: ${e.message}`);
  }

  const stats = await getLinkMethodStats();
  if (stats.length) {
    console.log("\nlink methods:");
    for (const s of stats) {
      console.log(
        `  ${s.method.padEnd(14)} ${String(s.count).padStart(4)}  avg relevance ${s.avgRelevance.toFixed(2)}`,
      );
    }
  }

  await closeDb();
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
