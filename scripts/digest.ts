/**
 * Build this morning's digest, and send it if email is configured.
 *
 *   npm run digest
 *   npm run digest -- --no-send    # rebuild without delivering
 *
 * One digest per calendar day: re-running refreshes the stored copy and does
 * not send a second email.
 */
import { closeDb } from "@/db";
import { sendDigest } from "@/ingest/digest";
import { loadEnvFiles } from "@/lib/load-env";

loadEnvFiles();

async function main() {
  const deliver = !process.argv.includes("--no-send");
  const result = await sendDigest({ deliver });

  console.log(
    `[${result.job}] ${result.status}: ${result.forDate}, ` +
      `${result.itemCount} items, ` +
      `${result.summarised ? "summarised" : "no summary"}, ` +
      `${result.delivered ? "delivered" : "not delivered"}` +
      `${result.rewritten ? ", refreshed an existing digest" : ""}`,
  );
  if (result.error) console.error(`  ${result.error}`);
  console.log("  read it at /digest");

  await closeDb();
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
