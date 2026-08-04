import { NewsItem } from "@/components/news-item";
import { LOW_SIGNAL_THRESHOLD } from "@/news/classify";
import type { FeedItem } from "@/services/news";

/**
 * A feed split by materiality.
 *
 * Ordering stays chronological — this is a news feed, and reordering by score
 * makes it impossible to tell what is new. Instead, low-signal items are
 * collapsed behind a disclosure: analyst notes and listicles remain reachable
 * without letting them dominate, which is the whole point of scoring them.
 */
export async function NewsFeed({
  items,
  currentTicker,
  emptyMessage = "No news yet. Run the news ingest to populate this feed.",
}: {
  items: FeedItem[];
  currentTicker?: string;
  emptyMessage?: string;
}) {
  const material = items.filter((i) => i.materiality >= LOW_SIGNAL_THRESHOLD);
  const lowSignal = items.filter((i) => i.materiality < LOW_SIGNAL_THRESHOLD);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
        <p className="text-sm text-neutral-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      <div>
        {material.map((item) => (
          <NewsItem
            key={item.storyId}
            item={item}
            currentTicker={currentTicker}
          />
        ))}
      </div>

      {lowSignal.length > 0 && (
        <details className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300">
            {lowSignal.length} lower-signal{" "}
            {lowSignal.length === 1 ? "item" : "items"} (opinion, analyst notes)
          </summary>
          <div className="mt-2 opacity-70">
            {lowSignal.map((item) => (
              <NewsItem
                key={item.storyId}
                item={item}
                currentTicker={currentTicker}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
