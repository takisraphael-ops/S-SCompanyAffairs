import { desc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { PARAM_SCHEMAS, describeRule, parseParams } from "@/alerts/rules";
import { getDb } from "@/db";
import {
  alertEvents,
  alertRules,
  digests,
  securities,
  type AlertChannel,
  type AlertKind,
  type Digest,
} from "@/db/schema";

/**
 * Reads and writes for the alerts UI.
 *
 * Rules are validated here as well as in the form action. The form action
 * stops bad input reaching the database; this stops a row that predates a
 * schema change from reaching the evaluator, which is a different problem
 * with the same answer.
 */

export class AlertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertError";
  }
}

export interface RuleRow {
  id: string;
  kind: AlertKind;
  channel: AlertChannel;
  enabled: boolean;
  /** Null when the rule follows the whole watchlist. */
  ticker: string | null;
  securityId: string | null;
  /** The rule as a sentence. */
  description: string;
  createdAt: Date;
  /** How many times it has fired, ever. */
  firedCount: number;
  lastFiredAt: Date | null;
}

export async function listRules(): Promise<RuleRow[]> {
  const rows = await getDb().execute<{
    id: string;
    kind: AlertKind;
    channel: AlertChannel;
    enabled: boolean;
    params: unknown;
    security_id: string | null;
    ticker: string | null;
    created_at: Date;
    fired_count: number;
    last_fired_at: Date | null;
  }>(sql`
    select r.id, r.kind, r.channel, r.enabled, r.params, r.security_id,
           s.ticker, r.created_at,
           count(e.id)::int as fired_count,
           max(e.fired_at)  as last_fired_at
    from alert_rules r
    left join securities s on s.id = r.security_id
    left join alert_events e on e.rule_id = r.id
    group by r.id, s.ticker
    order by r.created_at desc
  `);

  return [...rows].map((r) => ({
    id: r.id,
    kind: r.kind,
    channel: r.channel,
    enabled: r.enabled,
    ticker: r.ticker,
    securityId: r.security_id,
    description: describeRule(
      r.kind,
      r.params,
      r.ticker ?? "Anything on your watchlist",
    ),
    createdAt: new Date(r.created_at),
    firedCount: r.fired_count,
    lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at) : null,
  }));
}

export interface EventRow {
  id: string;
  ticker: string | null;
  kind: AlertKind;
  title: string;
  body: string;
  url: string | null;
  firedAt: Date;
  readAt: Date | null;
  deliveredAt: Date | null;
  deliveryError: string | null;
}

export async function listEvents(limit = 100): Promise<EventRow[]> {
  const rows = await getDb().execute<{
    id: string;
    ticker: string | null;
    kind: AlertKind;
    title: string;
    body: string;
    url: string | null;
    fired_at: Date;
    read_at: Date | null;
    delivered_at: Date | null;
    delivery_error: string | null;
  }>(sql`
    select e.id, s.ticker, r.kind, e.title, e.body, e.url,
           e.fired_at, e.read_at, e.delivered_at, e.delivery_error
    from alert_events e
    join alert_rules r on r.id = e.rule_id
    left join securities s on s.id = e.security_id
    order by e.fired_at desc
    limit ${limit}
  `);

  return [...rows].map((r) => ({
    id: r.id,
    ticker: r.ticker,
    kind: r.kind,
    title: r.title,
    body: r.body,
    url: r.url,
    firedAt: new Date(r.fired_at),
    readAt: r.read_at ? new Date(r.read_at) : null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    deliveryError: r.delivery_error,
  }));
}

/**
 * Unread count for the header badge.
 *
 * Request-scoped through React's `cache`, because the layout renders on every
 * page and this would otherwise be one query per navigation per component
 * that asks.
 */
export const countUnread = cache(async (): Promise<number> => {
  const rows = await getDb().execute<{ n: number }>(
    sql`select count(*)::int as n from alert_events where read_at is null`,
  );
  return [...rows][0]?.n ?? 0;
});

export interface CreateRuleInput {
  kind: AlertKind;
  /** A ticker, or null for the whole watchlist. */
  ticker: string | null;
  params: unknown;
  channel: AlertChannel;
}

export async function createRule(input: CreateRuleInput): Promise<string> {
  if (!(input.kind in PARAM_SCHEMAS)) {
    throw new AlertError(`Unknown alert kind: ${input.kind}`);
  }

  // Throws InvalidRuleError with a readable message; the action surfaces it.
  const params = parseParams(input.kind, input.params);

  let securityId: string | null = null;
  if (input.ticker) {
    const found = await getDb()
      .select({ id: securities.id })
      .from(securities)
      .where(eq(securities.ticker, input.ticker.toUpperCase()))
      .limit(1);
    if (!found[0]) {
      throw new AlertError(`${input.ticker} is not on your watchlist.`);
    }
    securityId = found[0].id;
  }

  const [row] = await getDb()
    .insert(alertRules)
    .values({
      kind: input.kind,
      securityId,
      params: params as Record<string, unknown>,
      channel: input.channel,
    })
    .returning({ id: alertRules.id });

  if (!row) throw new AlertError("Could not save the rule.");
  return row.id;
}

export async function setRuleEnabled(
  ruleId: string,
  enabled: boolean,
): Promise<void> {
  await getDb()
    .update(alertRules)
    .set({ enabled })
    .where(eq(alertRules.id, ruleId));
}

/**
 * Deleting a rule takes its firings with it, by cascade.
 *
 * Deliberate: the events say "AAPL rose above the level you set", and without
 * the rule there is no level to refer to. Someone who wants to stop the
 * notifications and keep the history disables the rule instead, which is why
 * that is the more prominent control in the UI.
 */
export async function deleteRule(ruleId: string): Promise<void> {
  await getDb().delete(alertRules).where(eq(alertRules.id, ruleId));
}

export async function markRead(eventId: string): Promise<void> {
  await getDb()
    .update(alertEvents)
    .set({ readAt: new Date() })
    .where(eq(alertEvents.id, eventId));
}

export async function markAllRead(): Promise<number> {
  const updated = await getDb()
    .update(alertEvents)
    .set({ readAt: new Date() })
    .where(sql`${alertEvents.readAt} is null`)
    .returning({ id: alertEvents.id });
  return updated.length;
}

/** The most recent digest, for /digest. */
export async function getLatestDigest(): Promise<Digest | null> {
  const rows = await getDb()
    .select()
    .from(digests)
    .orderBy(desc(digests.forDate))
    .limit(1);
  return rows[0] ?? null;
}

export async function listDigestDates(
  limit = 14,
): Promise<Array<{ forDate: Date; itemCount: number }>> {
  const rows = await getDb()
    .select({ forDate: digests.forDate, itemCount: digests.itemCount })
    .from(digests)
    .orderBy(desc(digests.forDate))
    .limit(limit);
  return rows;
}
