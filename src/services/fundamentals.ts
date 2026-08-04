import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  aiGenerations,
  companyEvents,
  filings,
  fundamentals,
  type CompanyEvent,
  type Filing,
  type PeriodType,
} from "@/db/schema";
import { deriveMetrics } from "@/lib/derive";

export interface MetricValue {
  metricKey: string;
  value: number;
  unit: string;
  /** Reported by a filing, or computed by us from reported figures. */
  origin: "reported" | "derived";
}

export interface PeriodSnapshot {
  periodEnd: Date;
  periodType: PeriodType;
  metrics: MetricValue[];
}

/**
 * The most recent period for a company, with derived metrics folded in.
 *
 * Reported facts and derived ones are returned together but tagged, because
 * the distinction matters: a restated margin should be traceable to the
 * revenue and profit it came from, and a reader deserves to know which
 * numbers the company asserted and which the app worked out.
 */
export async function getLatestFundamentals(
  securityId: string,
  opts: { periodType?: PeriodType; price?: number | null } = {},
): Promise<PeriodSnapshot | null> {
  const db = getDb();
  const periodType = opts.periodType ?? "annual";

  const rows = await db
    .select({
      metricKey: fundamentals.metricKey,
      value: fundamentals.value,
      unit: fundamentals.unit,
      periodEnd: fundamentals.periodEnd,
    })
    .from(fundamentals)
    .where(
      and(
        eq(fundamentals.securityId, securityId),
        eq(fundamentals.periodType, periodType),
      ),
    )
    .orderBy(desc(fundamentals.periodEnd));

  if (rows.length === 0) return null;

  // Take the newest period only. Metrics are filed at slightly different
  // times, so "newest" is decided per company, not per metric.
  const latestEnd = rows[0]!.periodEnd;
  const latest = rows.filter(
    (r) => r.periodEnd.getTime() === latestEnd.getTime(),
  );

  const facts = new Map<string, number>();
  const reported: MetricValue[] = [];

  for (const row of latest) {
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    facts.set(row.metricKey, value);
    reported.push({
      metricKey: row.metricKey,
      value,
      unit: row.unit,
      origin: "reported",
    });
  }

  const derived = deriveMetrics({ facts, price: opts.price ?? null }).map(
    (d): MetricValue => ({ ...d, origin: "derived" }),
  );

  return {
    periodEnd: latestEnd,
    periodType,
    metrics: [...reported, ...derived],
  };
}

/**
 * A metric's history, oldest first, for showing a trend.
 *
 * Only reported facts — a derived series would need a price for every past
 * date, which is a different (and much heavier) question.
 */
export async function getMetricHistory(
  securityId: string,
  metricKey: string,
  opts: { periodType?: PeriodType; limit?: number } = {},
): Promise<Array<{ periodEnd: Date; value: number; unit: string }>> {
  const rows = await getDb()
    .select({
      periodEnd: fundamentals.periodEnd,
      value: fundamentals.value,
      unit: fundamentals.unit,
    })
    .from(fundamentals)
    .where(
      and(
        eq(fundamentals.securityId, securityId),
        eq(fundamentals.metricKey, metricKey),
        eq(fundamentals.periodType, opts.periodType ?? "annual"),
      ),
    )
    .orderBy(desc(fundamentals.periodEnd))
    .limit(opts.limit ?? 5);

  return rows
    .map((r) => ({
      periodEnd: r.periodEnd,
      value: Number(r.value),
      unit: r.unit,
    }))
    .filter((r) => Number.isFinite(r.value))
    .reverse();
}

export interface SummarisedFiling extends Filing {
  /** Plain-English note from the AI layer, when one has been generated. */
  summary: string | null;
  /** Which model wrote it; "mock" means placeholder text. */
  summaryModel: string | null;
}

/**
 * Filings with their generated summaries, in one query.
 *
 * The summary lives in `ai_generations` rather than on the filing row, so
 * there is exactly one copy of it and exactly one record of which model wrote
 * it. That costs one left join here and saves the two from ever disagreeing.
 */
export async function listFilings(
  securityId: string,
  limit = 25,
): Promise<SummarisedFiling[]> {
  const rows = await getDb()
    .select({
      filing: filings,
      summary: aiGenerations.body,
      summaryModel: aiGenerations.model,
    })
    .from(filings)
    .leftJoin(
      aiGenerations,
      and(
        eq(aiGenerations.kind, "filing_summary"),
        eq(aiGenerations.subjectKey, sql`${filings.id}::text`),
      ),
    )
    .where(eq(filings.securityId, securityId))
    .orderBy(desc(filings.filedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r.filing,
    summary: r.summary,
    summaryModel: r.summaryModel,
  }));
}

export interface DatedEvent extends CompanyEvent {
  isUpcoming: boolean;
  /** Whole days from now; negative for events already past. */
  daysAway: number;
}

/**
 * Upcoming events first, then recent past ones.
 *
 * "Upcoming" and "days away" are resolved here rather than in the component.
 * Reading the clock during render is impure — the same component would
 * produce different output on a re-render — so the time-dependent part is
 * settled once, at the data layer, and the UI just renders what it is given.
 */
export async function listEvents(
  securityId: string,
  limit = 8,
): Promise<DatedEvent[]> {
  const rows = await getDb()
    .select()
    .from(companyEvents)
    .where(eq(companyEvents.securityId, securityId))
    .orderBy(desc(companyEvents.scheduledAt))
    .limit(limit);

  const now = Date.now();
  const annotate = (e: CompanyEvent): DatedEvent => ({
    ...e,
    isUpcoming: e.scheduledAt.getTime() >= now,
    daysAway: Math.round((e.scheduledAt.getTime() - now) / 86_400_000),
  });

  const annotated = rows.map(annotate);
  const upcoming = annotated
    .filter((e) => e.isUpcoming)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const past = annotated.filter((e) => !e.isUpcoming);

  return [...upcoming, ...past];
}
