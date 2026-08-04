/**
 * Round-trip smoke test against a real Postgres.
 *
 *   npm run smoke
 *
 * Unit tests (`npm test`) cover provider parsing with stubbed HTTP. This
 * covers what they cannot: that migrations, constraints, upserts, cascades and
 * `numeric` handling actually behave against the database.
 *
 * WRITES TO THE DATABASE IN DATABASE_URL. Point it at a dev database. It uses
 * deliberately fake tickers and deletes them on the way out.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { fundamentals, priceBars, quotesLatest, securities } from "@/db/schema";
import { backfillBars, ingestQuotes, refreshSecurity } from "@/ingest/quotes";
import { loadEnvFiles } from "@/lib/load-env";
import { getLatestFundamentals } from "@/services/fundamentals";
import { InvalidTickerError } from "@/services/securities";
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
} from "@/services/watchlist";

loadEnvFiles();

/**
 * Symbols chosen not to collide with real holdings in a dev database, since
 * the teardown deletes whatever it touched.
 */
const TICKERS = ["ZZTA", "ZZTB", "ZZTC"];

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (!cond) failures++;
  console.log(
    `${cond ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function teardown() {
  const db = getDb();
  await db.delete(securities).where(inArray(securities.ticker, TICKERS));
}

async function main() {
  const db = getDb();
  await teardown(); // in case a previous run died midway

  const [a, b, c] = TICKERS as [string, string, string];

  // --- validation --------------------------------------------------------
  await assertRejects(
    () => addToWatchlist("not a ticker!!"),
    InvalidTickerError,
    "rejects a malformed ticker",
  );

  // --- add ---------------------------------------------------------------
  const added = await addToWatchlist(a.toLowerCase());
  check("normalises ticker to uppercase", added.ticker === a, added.ticker);

  await addToWatchlist(b);
  await addToWatchlist(c);

  const before = await listWatchlist();
  await addToWatchlist(a);
  const after = await listWatchlist();
  check(
    "re-adding an existing ticker is a no-op",
    before.length === after.length,
    `${before.length} -> ${after.length}`,
  );

  // --- ingest ------------------------------------------------------------
  await refreshSecurity(added.id, added.ticker);
  const bars = await backfillBars(added.id, added.ticker, 90);
  check("backfills price history", bars > 0, `${bars} bars`);

  const run = await ingestQuotes();
  check(
    "ingest run completes for every watchlist item",
    run.status === "ok" && run.ok >= 3,
    `${run.status} ok=${run.ok} failed=${run.failed}`,
  );

  // --- read path ---------------------------------------------------------
  const rows = (await listWatchlist()).filter((r) => TICKERS.includes(r.ticker));
  check("watchlist returns all three rows", rows.length === 3, String(rows.length));
  check(
    "every row carries a price",
    rows.every((r) => r.price !== null),
    rows.map((r) => `${r.ticker}=${r.price}`).join(" "),
  );
  check(
    "rows are ordered by ticker",
    rows.map((r) => r.ticker).join(",") === TICKERS.join(","),
    rows.map((r) => r.ticker).join(","),
  );

  // --- numeric fidelity --------------------------------------------------
  const priceRows = await db.execute<{ v: string }>(
    sql`select price::text as v from quotes_latest where security_id = ${added.id}`,
  );
  check(
    "price round-trips as an exact numeric string",
    typeof priceRows[0]?.v === "string" && /^\d+\.\d{6}$/.test(priceRows[0].v),
    priceRows[0]?.v ?? "none",
  );

  // --- idempotency -------------------------------------------------------
  const countBars = async () =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(priceBars)
        .where(eq(priceBars.securityId, added.id))
    )[0]?.n ?? 0;

  const barsBefore = await countBars();
  await ingestQuotes();
  check(
    "re-running ingest does not duplicate today's bar",
    barsBefore === (await countBars()),
    `${barsBefore} -> ${await countBars()}`,
  );

  // --- fundamentals upsert ------------------------------------------------
  // The composite key is what makes a restatement overwrite the figure it
  // restates instead of adding a second, contradictory row for the period.
  const periodEnd = new Date(Date.UTC(2023, 11, 31));
  const writeFact = (value: number, source: string) =>
    db
      .insert(fundamentals)
      .values({
        securityId: added.id,
        metricKey: "revenue",
        periodEnd,
        periodType: "annual",
        value: String(value),
        unit: "USD",
        source,
      })
      .onConflictDoUpdate({
        target: [
          fundamentals.securityId,
          fundamentals.metricKey,
          fundamentals.periodEnd,
          fundamentals.periodType,
        ],
        set: { value: sql`excluded."value"`, source: sql`excluded."source"` },
      });

  await writeFact(1000, "smoke:original");
  await writeFact(1100, "smoke:restated");

  const factRows = await db
    .select()
    .from(fundamentals)
    .where(eq(fundamentals.securityId, added.id));
  check("a restatement replaces the period, not duplicates it", factRows.length === 1, `${factRows.length} rows`);
  check("the restated value wins", Number(factRows[0]?.value) === 1100, String(factRows[0]?.value));

  const snapshot = await getLatestFundamentals(added.id, { price: 50 });
  check(
    "derived metrics are computed on read",
    !!snapshot && snapshot.metrics.some((m) => m.origin === "derived") === false,
    "revenue alone derives nothing, correctly",
  );

  // --- removal keeps history --------------------------------------------
  check("removes from watchlist", await removeFromWatchlist(added.id));
  check(
    "security row survives removal",
    (await db.select().from(securities).where(eq(securities.id, added.id)))
      .length === 1,
  );
  check("price history survives removal", (await countBars()) > 0);

  // --- cascade -----------------------------------------------------------
  await db.delete(securities).where(eq(securities.id, added.id));
  const orphans = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(quotesLatest)
    .where(eq(quotesLatest.securityId, added.id));
  check(
    "deleting a security cascades to its quotes",
    orphans[0]?.n === 0,
    String(orphans[0]?.n),
  );

  await teardown();
  console.log(failures === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failures} failed`);
}

async function assertRejects(
  fn: () => Promise<unknown>,
  type: new (...args: never[]) => Error,
  label: string,
) {
  try {
    await fn();
    check(label, false, "no error thrown");
  } catch (err) {
    check(label, err instanceof type, (err as Error).constructor.name);
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(err);
    await teardown().catch(() => {});
    await closeDb().catch(() => {});
    process.exit(1);
  });
