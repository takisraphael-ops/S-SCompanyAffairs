/**
 * Generate the summaries and classifications that are missing or stale.
 *
 *   npm run ingest:ai
 *   npm run ingest:ai -- --limit 5
 *
 * Safe to re-run: work is decided by the cache, so a second pass over an
 * unchanged database makes no API calls. The token counts printed at the end
 * are what this run actually paid for.
 */
import { closeDb } from "@/db";
import { ingestAi } from "@/ingest/ai";
import { getEnv } from "@/lib/env";
import { loadEnvFiles } from "@/lib/load-env";

loadEnvFiles();

function parseLimit(argv: string[]): number | undefined {
  const i = argv.indexOf("--limit");
  if (i === -1) return undefined;

  const raw = argv[i + 1];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`--limit needs a positive integer, got ${raw ?? "nothing"}`);
    process.exit(2);
  }
  return n;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const env = getEnv();

  if (env.LLM_PROVIDER === "mock") {
    console.log(
      "LLM_PROVIDER=mock — writing clearly-labelled placeholder text.\n" +
        "Set LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY for real summaries.\n",
    );
  }

  const result = await ingestAi(limit === undefined ? {} : { limit });

  console.log(
    `[${result.job}] ${result.status}: ${result.stories} story summaries, ` +
      `${result.filings} filing summaries, ${result.classified} reclassified, ` +
      `${result.skipped} already cached, ${result.failed} failed`,
  );
  console.log(
    `        tokens: ${result.inputTokens.toLocaleString()} in, ` +
      `${result.outputTokens.toLocaleString()} out`,
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
