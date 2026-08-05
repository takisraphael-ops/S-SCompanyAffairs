import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db";
import {
  conceptEdges,
  conceptMetrics,
  concepts,
  userProgress,
  userSettings,
  type Concept,
  type ConceptLevel,
} from "@/db/schema";
import { dependents, transitivePrerequisites, type DagNode } from "@/lib/dag";

/**
 * Single-user for now. Every user-scoped table is keyed by this so adding
 * real accounts later is a migration, not a rewrite.
 */
export const DEFAULT_USER_ID = "local";

export interface ConceptSummary {
  id: string;
  slug: string;
  term: string;
  oneLiner: string;
  level: ConceptLevel;
  category: string;
}

export interface ConceptIndex {
  bySlug: Map<string, ConceptSummary>;
  /** metric_key -> the concept that explains it. Powers <MetricLabel>. */
  byMetric: Map<string, ConceptSummary>;
  ordered: ConceptSummary[];
  nodes: DagNode[];
}

/**
 * The whole concept graph, minus article bodies.
 *
 * Wrapped in React's `cache` so a page rendering fifty <Term>s issues one
 * query, not fifty. This is what makes explain-in-place affordable enough to
 * use by default rather than sparingly. The dataset is ~77 rows; loading it
 * whole is cheaper than any per-term lookup scheme.
 */
export const getConceptIndex = cache(async (): Promise<ConceptIndex> => {
  const db = getDb();

  const [rows, edges, metrics] = await Promise.all([
    db
      .select({
        id: concepts.id,
        slug: concepts.slug,
        term: concepts.term,
        oneLiner: concepts.oneLiner,
        level: concepts.level,
        category: concepts.category,
      })
      .from(concepts)
      .orderBy(asc(concepts.sortOrder)),
    db
      .select({
        conceptId: conceptEdges.conceptId,
        prerequisiteId: conceptEdges.prerequisiteId,
      })
      .from(conceptEdges),
    db
      .select({
        metricKey: conceptMetrics.metricKey,
        conceptId: conceptMetrics.conceptId,
      })
      .from(conceptMetrics),
  ]);

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const requiresByConcept = new Map<string, string[]>();
  for (const e of edges) {
    const from = byId.get(e.conceptId)?.slug;
    const to = byId.get(e.prerequisiteId)?.slug;
    if (!from || !to) continue;
    const list = requiresByConcept.get(from) ?? [];
    list.push(to);
    requiresByConcept.set(from, list);
  }

  const byMetric = new Map<string, ConceptSummary>();
  for (const m of metrics) {
    const concept = byId.get(m.conceptId);
    if (concept) byMetric.set(m.metricKey, concept);
  }

  return {
    bySlug,
    byMetric,
    ordered: rows,
    nodes: rows.map((r) => ({
      slug: r.slug,
      requires: requiresByConcept.get(r.slug) ?? [],
    })),
  };
});

export interface ConceptPage {
  concept: Concept;
  /** Transitive prerequisites in study order — dependencies first. */
  prerequisites: ConceptSummary[];
  /** Concepts that build directly on this one. */
  buildsInto: ConceptSummary[];
  /** Metric keys this concept explains. */
  metricKeys: string[];
  understood: boolean;
}

export async function getConceptPage(
  slug: string,
): Promise<ConceptPage | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(concepts)
    .where(eq(concepts.slug, slug))
    .limit(1);
  if (!row) return null;

  const index = await getConceptIndex();

  const [metricRows, progressRows] = await Promise.all([
    db
      .select({ metricKey: conceptMetrics.metricKey })
      .from(conceptMetrics)
      .where(eq(conceptMetrics.conceptId, row.id)),
    db
      .select({ status: userProgress.status })
      .from(userProgress)
      .where(eq(userProgress.conceptId, row.id))
      .limit(1),
  ]);

  const resolve = (s: string) => index.bySlug.get(s);

  return {
    concept: row,
    prerequisites: transitivePrerequisites(slug, index.nodes)
      .map(resolve)
      .filter((c): c is ConceptSummary => !!c),
    buildsInto: dependents(slug, index.nodes)
      .map(resolve)
      .filter((c): c is ConceptSummary => !!c),
    metricKeys: metricRows.map((m) => m.metricKey),
    understood: progressRows[0]?.status === "understood",
  };
}

/** All concepts grouped by category, preserving authored order. */
export async function listConceptsByCategory(): Promise<
  Array<{ category: string; concepts: ConceptSummary[] }>
> {
  const { ordered } = await getConceptIndex();
  const groups: Array<{ category: string; concepts: ConceptSummary[] }> = [];

  for (const c of ordered) {
    let group = groups.find((g) => g.category === c.category);
    if (!group) {
      group = { category: c.category, concepts: [] };
      groups.push(group);
    }
    group.concepts.push(c);
  }
  return groups;
}

/** Slugs the user has marked as understood. */
export const getUnderstoodSlugs = cache(async (): Promise<Set<string>> => {
  const rows = await getDb()
    .select({ slug: concepts.slug })
    .from(userProgress)
    .innerJoin(concepts, eq(userProgress.conceptId, concepts.id))
    .where(eq(userProgress.status, "understood"));

  return new Set(rows.map((r) => r.slug));
});

/**
 * The reader's assumed knowledge level, controlling how much scaffolding the
 * UI shows. Defaults to beginner without writing a row — the setting only
 * persists once deliberately changed.
 */
export const getUserLevel = cache(async (): Promise<ConceptLevel> => {
  const rows = await getDb()
    .select({ level: userSettings.level })
    .from(userSettings)
    .where(eq(userSettings.userId, DEFAULT_USER_ID))
    .limit(1);

  return rows[0]?.level ?? "beginner";
});

export async function setUserLevel(level: ConceptLevel): Promise<void> {
  await getDb()
    .insert(userSettings)
    .values({ userId: DEFAULT_USER_ID, level })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { level, updatedAt: new Date() },
    });
}

export async function setUnderstood(
  conceptId: string,
  understood: boolean,
): Promise<void> {
  const db = getDb();

  if (!understood) {
    await db
      .delete(userProgress)
      .where(eq(userProgress.conceptId, conceptId));
    return;
  }

  await db
    .insert(userProgress)
    .values({
      userId: DEFAULT_USER_ID,
      conceptId,
      status: "understood",
    })
    .onConflictDoUpdate({
      target: [userProgress.userId, userProgress.conceptId],
      set: { status: "understood", lastSeenAt: new Date() },
    });
}

const LEVEL_RANK: Record<ConceptLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

/** True when a concept is at or below the reader's declared level. */
export function isAtOrBelow(
  conceptLevel: ConceptLevel,
  userLevel: ConceptLevel,
): boolean {
  return LEVEL_RANK[conceptLevel] <= LEVEL_RANK[userLevel];
}
