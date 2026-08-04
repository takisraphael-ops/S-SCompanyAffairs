import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRelativeTime } from "@/lib/format";
import { listStoryArticles } from "@/services/news";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every copy of one story.
 *
 * This is the audit view for clustering: if the feed collapsed something it
 * should not have, this is where that becomes visible. Ordered the same way
 * the canonical article is chosen — best-sourced first.
 */
export default async function StoryPage({ params }: Props) {
  const { id } = await params;
  // The id reaches SQL as a uuid parameter; reject malformed input up front
  // so a bad link 404s rather than erroring on a cast.
  if (!UUID_RE.test(id)) notFound();

  const articles = await listStoryArticles(id);
  if (articles.length === 0) notFound();

  return (
    <div>
      <Link
        href="/news"
        className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        ← News
      </Link>

      <header className="mt-4 mb-6">
        <h2 className="text-lg font-semibold tracking-tight">
          {articles.length} {articles.length === 1 ? "report" : "reports"} of
          this story
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          The feed shows the best-sourced copy. These are all of them, in the
          order they were ranked.
        </p>
      </header>

      <ol className="space-y-4">
        {articles.map((a, i) => (
          <li
            key={a.id}
            className="border-b border-neutral-100 pb-4 last:border-0 dark:border-neutral-900"
          >
            <div className="flex items-baseline gap-2">
              {i === 0 && (
                <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white dark:bg-white dark:text-neutral-900">
                  Shown
                </span>
              )}
              <h3 className="text-[15px] font-medium leading-snug">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  {a.title}
                </a>
              </h3>
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              {a.publisher ?? a.sourceName} · {formatRelativeTime(a.publishedAt)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
