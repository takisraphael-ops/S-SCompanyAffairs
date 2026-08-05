import { findCycle } from "@/lib/dag";
import { METRIC_KEYS } from "@/lib/metrics";
import { CATEGORIES, type ConceptSource } from "./types";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Structural checks over the authored content.
 *
 * Run by the seeder before anything touches the database, and by the test
 * suite, so a broken reference fails in CI rather than producing a concept
 * page that 500s at runtime.
 */
export function validateConcepts(list: ConceptSource[]): string[] {
  const errors: string[] = [];
  const bySlug = new Map<string, ConceptSource>();

  for (const c of list) {
    if (!SLUG_RE.test(c.slug)) {
      errors.push(`"${c.slug}": slug must be lowercase kebab-case`);
    }
    if (bySlug.has(c.slug)) {
      errors.push(`"${c.slug}": duplicate slug`);
    }
    bySlug.set(c.slug, c);

    if (!c.term.trim()) errors.push(`"${c.slug}": term is empty`);
    if (!c.oneLiner.trim()) errors.push(`"${c.slug}": oneLiner is empty`);
    if (!c.body.trim()) errors.push(`"${c.slug}": body is empty`);

    // The one-liner has to fit a tooltip; anything longer belongs in the body.
    if (c.oneLiner.length > 160) {
      errors.push(
        `"${c.slug}": oneLiner is ${c.oneLiner.length} chars, keep it under 160`,
      );
    }
    if (!CATEGORIES.includes(c.category)) {
      errors.push(`"${c.slug}": unknown category "${c.category}"`);
    }
    if (c.requires?.includes(c.slug)) {
      errors.push(`"${c.slug}": lists itself as a prerequisite`);
    }
  }

  // Prerequisites must resolve.
  for (const c of list) {
    for (const req of c.requires ?? []) {
      if (!bySlug.has(req)) {
        errors.push(`"${c.slug}": requires unknown concept "${req}"`);
      }
    }
  }

  // A metric has exactly one explanation.
  const metricOwners = new Map<string, string>();
  for (const c of list) {
    for (const key of c.metrics ?? []) {
      const existing = metricOwners.get(key);
      if (existing) {
        errors.push(
          `metric "${key}" is claimed by both "${existing}" and "${c.slug}"`,
        );
      }
      metricOwners.set(key, c.slug);
    }
  }

  // Every metric the UI can render must be explainable.
  for (const key of METRIC_KEYS) {
    if (!metricOwners.has(key)) {
      errors.push(
        `metric "${key}" is rendered by the app but no concept explains it`,
      );
    }
  }

  const cycle = findCycle(
    list.map((c) => ({ slug: c.slug, requires: c.requires ?? [] })),
  );
  if (cycle) {
    errors.push(`prerequisite cycle: ${cycle.join(" -> ")}`);
  }

  return errors;
}

/** Internal /learn/<slug> links in bodies that point at concepts we do not have. */
export function findBrokenLinks(list: ConceptSource[]): string[] {
  const slugs = new Set(list.map((c) => c.slug));
  const broken: string[] = [];

  for (const c of list) {
    for (const match of c.body.matchAll(/\]\(\/learn\/([a-z0-9-]+)\)/g)) {
      const target = match[1];
      if (target && !slugs.has(target)) {
        broken.push(`"${c.slug}": links to missing concept "/learn/${target}"`);
      }
    }
  }
  return broken;
}
