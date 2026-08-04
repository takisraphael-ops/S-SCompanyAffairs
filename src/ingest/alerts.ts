import { eq, sql } from "drizzle-orm";
import {
  matchArticle,
  matchFiling,
  evaluateCondition,
  type CandidateArticle,
  type CandidateFiling,
  type Firing,
  type SecurityRef,
} from "@/alerts/evaluate";
import { InvalidRuleError, RULE_TRIGGER } from "@/alerts/rules";
import { getDb } from "@/db";
import {
  alertEvents,
  alertRules,
  alertStates,
  ingestRuns,
  type AlertRule,
} from "@/db/schema";
import { getEnv } from "@/lib/env";
import { isProviderError } from "@/providers/errors";
import { getEmailNotifier } from "@/providers/registry";

/**
 * Evaluating every enabled rule and firing what has not already fired.
 *
 * The job is deliberately dull. All the judgement is in src/alerts/evaluate.ts
 * where it can be tested without a database; what happens here is the part
 * that needs one — reading current state, deciding against the previous
 * evaluation, and writing the result exactly once.
 *
 * Three guards against the failure this whole phase exists to avoid:
 *
 *  1. **Arming.** A condition rule fires on the transition into its condition
 *     and re-arms when the condition stops holding. Without it, "AAPL above
 *     $200" notifies every thirty minutes for as long as it is true.
 *  2. **Dedupe keys.** Event rules key on the row that triggered them, so a
 *     filing can fire a rule once and never again.
 *  3. **A unique index.** Both of the above are logic, and logic can be
 *     wrong or race with itself. The database refuses the second insert.
 */

export interface AlertIngestResult {
  runId: string;
  job: string;
  status: "ok" | "partial" | "failed";
  /** Rules evaluated, including those that did not fire. */
  evaluated: number;
  fired: number;
  /** Firings the dedupe key had already recorded. */
  suppressed: number;
  /** Condition rules that returned to normal and can fire again. */
  rearmed: number;
  delivered: number;
  failed: number;
  errors: Array<{ target: string; message: string }>;
}

interface Target {
  security: SecurityRef;
  price: number | null;
  changePct: number | null;
  nextEarningsAt: Date | null;
}

/**
 * Everything a condition rule could need, for every watchlist company, in one
 * query.
 *
 * Per-rule lookups would be a query each and mostly the same query: ten rules
 * on one ticker all want the same price. Alerts are the job most likely to
 * run on a schedule someone forgot about, so it should stay cheap as rules
 * accumulate.
 */
async function loadTargets(): Promise<Map<string, Target>> {
  const rows = await getDb().execute<{
    id: string;
    ticker: string;
    name: string;
    price: string | null;
    change_pct: string | null;
    next_earnings_at: Date | null;
  }>(sql`
    select
      s.id, s.ticker, s.name,
      q.price, q.change_pct,
      (
        select min(e.scheduled_at)
        from company_events e
        where e.security_id = s.id
          and e.kind = 'earnings'
          and e.scheduled_at >= now()
      ) as next_earnings_at
    from watchlist_items w
    join securities s on s.id = w.security_id
    left join quotes_latest q on q.security_id = s.id
    order by s.ticker
  `);

  return new Map(
    [...rows].map((r) => [
      r.id,
      {
        security: { id: r.id, ticker: r.ticker, name: r.name },
        price: r.price === null ? null : Number(r.price),
        changePct: r.change_pct === null ? null : Number(r.change_pct),
        nextEarningsAt: r.next_earnings_at
          ? new Date(r.next_earnings_at)
          : null,
      },
    ]),
  );
}

/**
 * Which companies a rule watches.
 *
 * A rule with no security follows the watchlist rather than a snapshot of it,
 * so a ticker added tomorrow is covered by a rule written today. That is
 * almost always what someone means by "any of my stocks".
 */
function targetsFor(rule: AlertRule, all: Map<string, Target>): Target[] {
  if (!rule.securityId) return [...all.values()];
  const one = all.get(rule.securityId);
  return one ? [one] : [];
}

/**
 * How far back an event rule looks.
 *
 * Two bounds, for two different reasons.
 *
 * **Never before the rule existed.** A rule is a statement about what you
 * want to be told from now on, not a search of what you have already stored.
 * Without this, creating a broad rule against a database holding a month of
 * news fires sixty times at once, and the feature is deleted in irritation
 * before it has told anyone anything.
 *
 * **Never more than the configured window.** This one covers the opposite
 * case: a rule created a fortnight ago against a job that has not run since.
 * Catching up on a fortnight in one burst has the same effect as the flood
 * above, so the run does the recent part and moves on.
 */
function eventFloor(rule: AlertRule, now: Date): Date {
  const cap = new Date(
    now.getTime() - getEnv().ALERT_LOOKBACK_DAYS * 86_400_000,
  );
  return rule.createdAt > cap ? rule.createdAt : cap;
}

async function candidateArticles(
  securityId: string,
  since: Date,
): Promise<CandidateArticle[]> {
  const rows = await getDb().execute<{
    id: string;
    title: string;
    snippet: string | null;
    url: string;
    materiality: string;
    published_at: Date;
  }>(sql`
    select a.id, a.title, a.snippet, a.url_original as url,
           a.materiality, a.published_at
    from article_links l
    join articles a on a.id = l.article_id
    where l.security_id = ${securityId}
      and a.created_at >= ${since.toISOString()}::timestamptz
      and l.relevance >= 0.5
    order by a.published_at desc
    limit 200
  `);

  return [...rows].map((r) => ({
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    url: r.url,
    materiality: Number(r.materiality),
    publishedAt: new Date(r.published_at),
  }));
}

async function candidateFilings(
  securityId: string,
  since: Date,
): Promise<CandidateFiling[]> {
  const rows = await getDb().execute<{
    id: string;
    form_type: string;
    filed_at: Date;
    url: string;
  }>(sql`
    select f.id, f.form_type, f.filed_at, f.url
    from filings f
    where f.security_id = ${securityId}
      and f.created_at >= ${since.toISOString()}::timestamptz
    order by f.filed_at desc
    limit 100
  `);

  return [...rows].map((r) => ({
    id: r.id,
    formType: r.form_type,
    filedAt: new Date(r.filed_at),
    url: r.url,
  }));
}

/**
 * Record a firing, or discover it already happened.
 *
 * `onConflictDoNothing` on the dedupe index turns the race between two
 * overlapping cron runs into a no-op rather than a duplicate or an error.
 * The empty return is how the caller learns which of the two it was.
 */
async function recordFiring(
  rule: AlertRule,
  securityId: string | null,
  firing: Firing,
): Promise<string | null> {
  const inserted = await getDb()
    .insert(alertEvents)
    .values({
      ruleId: rule.id,
      securityId,
      dedupeKey: firing.dedupeKey,
      title: firing.title,
      body: firing.body,
      url: firing.url,
      payload: firing.payload,
    })
    .onConflictDoNothing({
      target: [alertEvents.ruleId, alertEvents.dedupeKey],
    })
    .returning({ id: alertEvents.id });

  return inserted[0]?.id ?? null;
}

/** Set or clear a condition rule's readiness to fire. */
async function setArmed(
  ruleId: string,
  securityId: string,
  armed: boolean,
  firedAt?: Date,
): Promise<void> {
  await getDb()
    .insert(alertStates)
    .values({ ruleId, securityId, armed, lastFiredAt: firedAt ?? null })
    .onConflictDoUpdate({
      target: [alertStates.ruleId, alertStates.securityId],
      set: {
        armed,
        updatedAt: new Date(),
        ...(firedAt ? { lastFiredAt: firedAt } : {}),
      },
    });
}

/**
 * Send a firing on its channel and record what happened.
 *
 * A delivery failure is written against the row rather than thrown, because
 * the alert itself already succeeded: it is in the inbox, and the page will
 * show it whether or not the email went out. Losing the alert because the
 * mail provider was down would be the worse of the two failures.
 */
async function deliver(
  eventId: string,
  rule: AlertRule,
  firing: Firing,
): Promise<boolean> {
  if (rule.channel === "inbox") {
    // The row is the delivery.
    await getDb()
      .update(alertEvents)
      .set({ deliveredAt: new Date() })
      .where(eq(alertEvents.id, eventId));
    return true;
  }

  try {
    await getEmailNotifier().send({
      subject: firing.title,
      body: `${firing.body}\n\n${firing.url ?? ""}`.trim(),
      idempotencyKey: eventId,
    });
    await getDb()
      .update(alertEvents)
      .set({ deliveredAt: new Date(), deliveryError: null })
      .where(eq(alertEvents.id, eventId));
    return true;
  } catch (err) {
    const message =
      isProviderError(err) || err instanceof Error ? err.message : String(err);
    await getDb()
      .update(alertEvents)
      .set({ deliveryError: message.slice(0, 500) })
      .where(eq(alertEvents.id, eventId));
    return false;
  }
}

export async function ingestAlerts(): Promise<AlertIngestResult> {
  const db = getDb();
  const job = "alerts";
  const now = new Date();

  const [run] = await db
    .insert(ingestRuns)
    .values({ job, status: "running" })
    .returning({ id: ingestRuns.id });
  if (!run) throw new Error("could not create ingest run");

  const rules = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.enabled, true));

  const targets = await loadTargets();

  const armedRows = await db.select().from(alertStates);
  const armedBy = new Map(
    armedRows.map((r) => [`${r.ruleId}:${r.securityId}`, r.armed]),
  );

  const counts = { fired: 0, suppressed: 0, rearmed: 0, delivered: 0 };
  const errors: AlertIngestResult["errors"] = [];
  let evaluated = 0;

  for (const rule of rules) {
    for (const target of targetsFor(rule, targets)) {
      evaluated++;
      const label = `${rule.kind}/${target.security.ticker}`;

      try {
        const firings: Firing[] = [];

        if (RULE_TRIGGER[rule.kind] === "condition") {
          const result = evaluateCondition(rule.kind, rule.params, {
            security: target.security,
            price: target.price,
            changePct: target.changePct,
            nextEarningsAt: target.nextEarningsAt,
            now,
          });

          const key = `${rule.id}:${target.security.id}`;
          // Absent state means never evaluated, which is armed: a rule
          // created while its condition already holds should fire once.
          const armed = armedBy.get(key) ?? true;

          if (!result.holds) {
            // Back to normal. Re-arming here, rather than on a timer, is
            // what makes the next crossing a new piece of news instead of a
            // repeat of the last one.
            if (!armed) {
              await setArmed(rule.id, target.security.id, true);
              counts.rearmed++;
            }
          } else if (armed && result.firing) {
            firings.push(result.firing);
            await setArmed(rule.id, target.security.id, false, now);
          }
        } else {
          const since = eventFloor(rule, now);

          if (rule.kind === "new_filing") {
            for (const filing of await candidateFilings(
              target.security.id,
              since,
            )) {
              const f = matchFiling(
                rule.kind,
                rule.params,
                filing,
                target.security,
              );
              if (f) firings.push(f);
            }
          } else {
            for (const art of await candidateArticles(
              target.security.id,
              since,
            )) {
              const f = matchArticle(
                rule.kind,
                rule.params,
                art,
                target.security,
              );
              if (f) firings.push(f);
            }
          }
        }

        for (const firing of firings) {
          const eventId = await recordFiring(rule, target.security.id, firing);
          if (!eventId) {
            counts.suppressed++;
            continue;
          }
          counts.fired++;
          if (await deliver(eventId, rule, firing)) counts.delivered++;
        }
      } catch (err) {
        // A rule whose parameters no longer parse is a configuration problem,
        // not an outage: it is reported and the remaining rules still run.
        errors.push({
          target: label,
          message:
            err instanceof InvalidRuleError ||
            isProviderError(err) ||
            err instanceof Error
              ? err.message
              : String(err),
        });
      }
    }
  }

  const status: AlertIngestResult["status"] =
    errors.length === 0 ? "ok" : errors.length === evaluated ? "failed" : "partial";

  await db
    .update(ingestRuns)
    .set({
      status,
      finishedAt: new Date(),
      itemsOk: counts.fired,
      itemsFailed: errors.length,
      error: errors.length
        ? errors.map((e) => `${e.target}: ${e.message}`).join("\n").slice(0, 4000)
        : null,
    })
    .where(eq(ingestRuns.id, run.id));

  return {
    runId: run.id,
    job,
    status,
    evaluated,
    ...counts,
    failed: errors.length,
    errors,
  };
}

/** Rules that reference a security no longer on the watchlist, for the UI. */
export async function countOrphanedRules(): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n
    from alert_rules r
    where r.security_id is not null
      and not exists (
        select 1 from watchlist_items w where w.security_id = r.security_id
      )
  `);
  return [...rows][0]?.n ?? 0;
}
