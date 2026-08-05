/**
 * Directed-acyclic-graph helpers for the concept prerequisite graph.
 *
 * Kept free of database and content types so both the seeder and the runtime
 * learning-path query use exactly the same traversal, and so the cycle
 * detection can be tested directly.
 */

export interface DagNode {
  slug: string;
  requires: string[];
}

/**
 * Returns a cycle as an ordered slug list (first slug repeated at the end),
 * or null if the graph is acyclic.
 *
 * Without this check a cycle would make `transitivePrerequisites` recurse
 * until the stack blows — an authoring typo taking down every concept page.
 */
export function findCycle(nodes: DagNode[]): string[] | null {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  function visit(slug: string): string[] | null {
    const current = state.get(slug);
    if (current === "done") return null;
    if (current === "visiting") {
      // Trim the stack back to where this slug first appeared.
      const start = stack.indexOf(slug);
      return [...stack.slice(start), slug];
    }

    state.set(slug, "visiting");
    stack.push(slug);

    for (const req of bySlug.get(slug)?.requires ?? []) {
      // Unknown slugs are reported separately by validation; skip them here
      // so a missing reference does not masquerade as a cycle.
      if (!bySlug.has(req)) continue;
      const cycle = visit(req);
      if (cycle) return cycle;
    }

    stack.pop();
    state.set(slug, "done");
    return null;
  }

  for (const node of nodes) {
    const cycle = visit(node.slug);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Every prerequisite of `slug`, transitively, ordered so that each entry
 * appears after anything it itself depends on. The slug itself is excluded.
 *
 * That ordering is the point: it is a study order, not just a set. Callers
 * must ensure the graph is acyclic — see findCycle.
 */
export function transitivePrerequisites(
  slug: string,
  nodes: DagNode[],
): string[] {
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const ordered: string[] = [];
  const seen = new Set<string>();

  function visit(current: string): void {
    if (seen.has(current)) return;
    seen.add(current);

    for (const req of bySlug.get(current)?.requires ?? []) {
      if (bySlug.has(req)) visit(req);
    }
    // Post-order: dependencies land before the thing that needs them.
    ordered.push(current);
  }

  for (const req of bySlug.get(slug)?.requires ?? []) {
    if (bySlug.has(req)) visit(req);
  }

  return ordered;
}

/** Slugs that directly depend on `slug` — the inverse edge. */
export function dependents(slug: string, nodes: DagNode[]): string[] {
  return nodes.filter((n) => n.requires.includes(slug)).map((n) => n.slug);
}
