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
import { inputHash, readGeneration, storeGeneration } from "@/ai/cache";
import type { PromptSpec } from "@/ai/prompts";
import { closeDb, getDb } from "@/db";
import {
  aiGenerations,
  alertEvents,
  alertRules,
  alertStates,
  fundamentals,
  priceBars,
  quotesLatest,
  securities,
  transactions,
} from "@/db/schema";
import { backfillBars, ingestQuotes, refreshSecurity } from "@/ingest/quotes";
import { loadEnvFiles } from "@/lib/load-env";
import { getLatestFundamentals } from "@/services/fundamentals";
import * as D from "@/lib/decimal";
import { LedgerError, getPortfolio, recordTransaction } from "@/services/portfolio";
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
  // Transactions reference securities with ON DELETE RESTRICT, deliberately —
  // so they have to go first.
  const ids = await db
    .select({ id: securities.id })
    .from(securities)
    .where(inArray(securities.ticker, TICKERS));
  if (ids.length) {
    await db.delete(transactions).where(
      inArray(
        transactions.securityId,
        ids.map((r) => r.id),
      ),
    );
    await db.delete(aiGenerations).where(
      inArray(
        aiGenerations.securityId,
        ids.map((r) => r.id),
      ),
    );
    await db.delete(alertRules).where(
      inArray(
        alertRules.securityId,
        ids.map((r) => r.id),
      ),
    );
  }
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

  // --- generation cache ---------------------------------------------------
  // The unique key is what makes regenerating a subject replace its answer
  // rather than accumulate superseded paraphrases beside it.
  const spec: PromptSpec = {
    kind: "story_summary",
    subject: "smoke",
    system: "s",
    user: "v1",
  };
  const store = (s: PromptSpec, body: string) =>
    storeGeneration({
      spec: s,
      subjectKey: `smoke:${added.id}`,
      body,
      model: "smoke",
      inputTokens: 1,
      outputTokens: 1,
      securityId: added.id,
    });

  await store(spec, "first");
  const restated: PromptSpec = { ...spec, user: "v2" };
  await store(restated, "second");

  const cached = await readGeneration("story_summary", `smoke:${added.id}`);
  check("regenerating replaces rather than appends", cached?.body === "second", cached?.body);
  check(
    "and records the new inputs, so the next read is a hit",
    cached?.inputHash === inputHash(restated),
  );

  const beforeCascade = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiGenerations)
    .where(eq(aiGenerations.securityId, added.id));
  check("generated text is attributed to its company", beforeCascade[0]?.n === 1);

  // --- alert dedupe --------------------------------------------------------
  // The index that makes a second firing impossible even when the logic above
  // it is wrong or two cron runs overlap. Asserted against the database
  // because that is where the guarantee lives.
  const [rule] = await db
    .insert(alertRules)
    .values({
      securityId: added.id,
      kind: "price_above",
      params: { threshold: 1 },
    })
    .returning({ id: alertRules.id });

  const fire = () =>
    db
      .insert(alertEvents)
      .values({
        ruleId: rule!.id,
        securityId: added.id,
        dedupeKey: "above:1:2024-01-01",
        title: "smoke",
        body: "smoke",
      })
      .onConflictDoNothing({
        target: [alertEvents.ruleId, alertEvents.dedupeKey],
      })
      .returning({ id: alertEvents.id });

  check("a firing is recorded once", (await fire()).length === 1);
  check("and the same firing again is a no-op", (await fire()).length === 0);

  // Arming is per company, so a watchlist-wide rule can be waiting on one
  // ticker while it has already fired for another.
  await db
    .insert(alertStates)
    .values({ ruleId: rule!.id, securityId: added.id, armed: false })
    .onConflictDoUpdate({
      target: [alertStates.ruleId, alertStates.securityId],
      set: { armed: false },
    });
  const state = await db
    .select()
    .from(alertStates)
    .where(eq(alertStates.ruleId, rule!.id));
  check("arming state is keyed by rule and company", state.length === 1 && state[0]?.armed === false);

  // --- portfolio ledger ---------------------------------------------------
  await recordTransaction({
    ticker: a,
    kind: "buy",
    tradeDate: new Date(Date.UTC(2024, 0, 10)),
    quantity: "100",
    price: "150",
    fees: "9.95",
  });

  const portfolio = await getPortfolio();
  const position = portfolio.positions.find((p) => p.ticker === a);
  check(
    "ledger rebuilds a position from the transaction log",
    !!position && D.toString(position.quantity) === "100",
    position ? D.toString(position.quantity) : "missing",
  );
  check(
    "cost basis is exact to the cent including fees",
    !!position && D.toString(position.costBasis) === "15009.95",
    position ? D.toString(position.costBasis) : "missing",
  );

  await assertRejects(
    () =>
      recordTransaction({
        ticker: a,
        kind: "sell",
        tradeDate: new Date(Date.UTC(2024, 2, 10)),
        quantity: "500",
        price: "200",
      }),
    LedgerError,
    "rejects a sale larger than the holding",
  );

  // Removing a security you hold must be blocked, or the ledger would lose
  // the other side of a transaction and every figure after it.
  let blocked = false;
  try {
    await db.delete(securities).where(eq(securities.id, added.id));
  } catch {
    blocked = true;
  }
  check("cannot delete a security with transactions against it", blocked);

  await db.delete(transactions).where(eq(transactions.securityId, added.id));

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

  const orphanText = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiGenerations)
    .where(eq(aiGenerations.securityId, added.id));
  check(
    "and takes its generated text with it",
    orphanText[0]?.n === 0,
    String(orphanText[0]?.n),
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
