/**
 * Seed authored concepts into Postgres.
 *
 *   npm run concepts:seed
 *
 * The repo is the source of truth; the database is the read path. Running
 * this is idempotent — concepts are upserted by slug, and concepts deleted
 * from the content files are removed from the database so the two cannot
 * silently diverge.
 *
 * Nothing is written until validation passes.
 */
import { notInArray } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { conceptEdges, conceptMetrics, concepts } from "@/db/schema";
import { ALL_CONCEPTS } from "@/content/concepts";
import { findBrokenLinks, validateConcepts } from "@/content/validate";
import { loadEnvFiles } from "@/lib/load-env";

loadEnvFiles();

async function main() {
  const errors = [...validateConcepts(ALL_CONCEPTS), ...findBrokenLinks(ALL_CONCEPTS)];
  if (errors.length) {
    console.error(`Content validation failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const db = getDb();

  await db.transaction(async (tx) => {
    // Upsert every concept, keeping ids stable so progress rows survive edits.
    for (const [i, c] of ALL_CONCEPTS.entries()) {
      await tx
        .insert(concepts)
        .values({
          slug: c.slug,
          term: c.term,
          aliases: c.aliases ?? [],
          oneLiner: c.oneLiner,
          body: c.body,
          level: c.level,
          category: c.category,
          sortOrder: i,
        })
        .onConflictDoUpdate({
          target: concepts.slug,
          set: {
            term: c.term,
            aliases: c.aliases ?? [],
            oneLiner: c.oneLiner,
            body: c.body,
            level: c.level,
            category: c.category,
            sortOrder: i,
            updatedAt: new Date(),
          },
        });
    }

    // Drop concepts that no longer exist in the content files. Cascades clear
    // their edges, metric mappings and progress rows.
    const keptSlugs = ALL_CONCEPTS.map((c) => c.slug);
    const removed = await tx
      .delete(concepts)
      .where(notInArray(concepts.slug, keptSlugs))
      .returning({ slug: concepts.slug });

    const rows = await tx
      .select({ id: concepts.id, slug: concepts.slug })
      .from(concepts);
    const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));

    // Edges and metric mappings are small and fully derived, so replace them
    // wholesale rather than diffing.
    await tx.delete(conceptEdges);
    await tx.delete(conceptMetrics);

    const edgeValues = ALL_CONCEPTS.flatMap((c) =>
      (c.requires ?? []).map((req) => ({
        conceptId: idBySlug.get(c.slug)!,
        prerequisiteId: idBySlug.get(req)!,
      })),
    );
    if (edgeValues.length) await tx.insert(conceptEdges).values(edgeValues);

    const metricValues = ALL_CONCEPTS.flatMap((c) =>
      (c.metrics ?? []).map((metricKey) => ({
        metricKey,
        conceptId: idBySlug.get(c.slug)!,
      })),
    );
    if (metricValues.length) {
      await tx.insert(conceptMetrics).values(metricValues);
    }

    console.log(
      `seeded ${ALL_CONCEPTS.length} concepts, ${edgeValues.length} prerequisite edges, ${metricValues.length} metric mappings`,
    );
    if (removed.length) {
      console.log(`removed ${removed.length}: ${removed.map((r) => r.slug).join(", ")}`);
    }
  });

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
