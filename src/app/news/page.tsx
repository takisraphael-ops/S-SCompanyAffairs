import type { Metadata } from "next";
import { NewsFeed } from "@/components/news-feed";
import { getLinkMethodStats, listWatchlistNews } from "@/services/news";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "News · S&S Company Affairs",
  description: "What is happening at the companies you follow.",
};

export default async function NewsPage() {
  const [items, methodStats] = await Promise.all([
    listWatchlistNews(),
    getLinkMethodStats(),
  ]);

  const totalArticles = items.reduce((n, i) => n + i.articleCount, 0);
  const collapsed = totalArticles - items.length;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">News</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {items.length === 0
            ? "Nothing yet."
            : `${items.length} ${items.length === 1 ? "story" : "stories"} across your watchlist` +
              (collapsed > 0
                ? `, with ${collapsed} duplicate ${collapsed === 1 ? "copy" : "copies"} collapsed.`
                : ".")}
        </p>
      </div>

      <NewsFeed
        items={items}
        emptyMessage="No news yet. Add companies to your watchlist, then run `npm run ingest:news`."
      />

      {/*
        Link provenance, surfaced rather than buried. The plan calls for
        measuring precision per matching method so the relevance rules can be
        tuned against evidence; this is where that evidence shows up.
      */}
      {methodStats.length > 0 && (
        <details className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
          <summary className="cursor-pointer hover:text-neutral-800 dark:hover:text-neutral-300">
            How these were matched
          </summary>
          <table className="mt-3 w-full max-w-md">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-400">
                <th className="py-1 font-medium">Method</th>
                <th className="py-1 text-right font-medium">Links</th>
                <th className="py-1 text-right font-medium">Avg confidence</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {methodStats.map((s) => (
                <tr key={s.method}>
                  <td className="py-1">{s.method}</td>
                  <td className="py-1 text-right">{s.count}</td>
                  <td className="py-1 text-right">
                    {s.avgRelevance.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
