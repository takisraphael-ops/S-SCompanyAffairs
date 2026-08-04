import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConceptBody } from "@/components/concept-body";
import { UnderstoodToggle } from "@/components/understood-toggle";
import { getConceptPage } from "@/services/concepts";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getConceptPage(slug);
  if (!page) return { title: "Not found" };

  return {
    title: `${page.concept.term} · S&S Company Affairs`,
    description: page.concept.oneLiner,
  };
}

export default async function ConceptPage({ params }: Props) {
  const { slug } = await params;
  const page = await getConceptPage(slug);
  if (!page) notFound();

  const { concept, prerequisites, buildsInto, metricKeys, understood } = page;

  return (
    <article>
      <Link
        href="/learn"
        className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← All concepts
      </Link>

      <header className="mt-4 mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">
            {concept.term}
          </h2>
          <span className="text-[10px] uppercase tracking-wide text-neutral-400">
            {concept.level} · {concept.category}
          </span>
        </div>
        <p className="mt-2 text-base text-neutral-600 dark:text-neutral-400">
          {concept.oneLiner}
        </p>
      </header>

      {prerequisites.length > 0 && (
        <aside className="mb-8 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Understand these first
          </h3>
          {/*
            Ordered by the prerequisite DAG so this reads as a study path:
            each entry appears after everything it itself depends on.
          */}
          <ol className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-sm">
            {prerequisites.map((p, i) => (
              <li key={p.slug} className="flex items-center gap-2">
                {i > 0 && <span className="text-neutral-300">→</span>}
                <Link
                  href={`/learn/${p.slug}`}
                  className="underline underline-offset-2 hover:opacity-70"
                >
                  {p.term}
                </Link>
              </li>
            ))}
          </ol>
        </aside>
      )}

      <ConceptBody markdown={concept.body} />

      {metricKeys.length > 0 && (
        <p className="mt-8 text-xs text-neutral-500">
          Explains the{" "}
          {metricKeys.map((k, i) => (
            <span key={k}>
              {i > 0 && ", "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
                {k}
              </code>
            </span>
          ))}{" "}
          {metricKeys.length === 1 ? "value" : "values"} shown in the app.
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <UnderstoodToggle conceptId={concept.id} understood={understood} />
      </div>

      {buildsInto.length > 0 && (
        <section className="mt-8">
          <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Builds into
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {buildsInto.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/learn/${c.slug}`}
                  className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
                >
                  {c.term}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
