import type { Metadata } from "next";
import Link from "next/link";
import { LevelSwitcher } from "@/components/level-switcher";
import {
  getUnderstoodSlugs,
  getUserLevel,
  isAtOrBelow,
  listConceptsByCategory,
} from "@/services/concepts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learn · S&S Company Affairs",
  description: "Every financial concept the app uses, explained.",
};

export default async function LearnIndex() {
  const [groups, level, understood] = await Promise.all([
    listConceptsByCategory(),
    getUserLevel(),
    getUnderstoodSlugs(),
  ]);

  const total = groups.reduce((n, g) => n + g.concepts.length, 0);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-lg font-semibold tracking-tight">Learn</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {total} concepts. {understood.size} marked understood. Every number
          the app shows links back to one of these.
        </p>
      </div>

      <div className="mb-10">
        <LevelSwitcher current={level} />
      </div>

      <div className="space-y-10">
        {groups.map((group) => (
          <section key={group.category}>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {group.category}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.concepts.map((c) => {
                // Above the reader's declared level: still listed, but marked,
                // so the glossary stays complete without feeling overwhelming.
                const beyond = !isAtOrBelow(c.level, level);
                return (
                  <li key={c.slug}>
                    <Link
                      href={`/learn/${c.slug}`}
                      className={`block rounded-lg border border-neutral-200 p-3 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600 ${
                        beyond ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">
                          {understood.has(c.slug) && (
                            <span className="mr-1 text-up" aria-label="understood">
                              ✓
                            </span>
                          )}
                          {c.term}
                        </span>
                        {beyond && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">
                            {c.level}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                        {c.oneLiner}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
