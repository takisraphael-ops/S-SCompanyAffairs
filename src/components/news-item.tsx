import Link from "next/link";
import { GeneratedNote } from "@/components/generated-note";
import { Term } from "@/components/term";
import { formatRelativeTime } from "@/lib/format";
import { EVENT_CONCEPT, EVENT_LABEL } from "@/news/classify";
import type { GeneratedText } from "@/services/ai";
import type { FeedItem } from "@/services/news";

/**
 * Badge naming what kind of event the article reports.
 *
 * Where P1 authored a concept for the event type, the badge is a <Term> — so
 * "Guidance" on a headline is explainable in place, exactly like a metric.
 */
async function EventBadge({ item }: { item: FeedItem }) {
  const label = EVENT_LABEL[item.eventType];
  const slug = EVENT_CONCEPT[item.eventType];

  const className =
    "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
    (item.materiality >= 0.6
      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
      : "border border-neutral-300 text-neutral-500 dark:border-neutral-700");

  if (!slug) return <span className={className}>{label}</span>;

  return (
    <span className={className}>
      <Term slug={slug}>{label}</Term>
    </span>
  );
}

export async function NewsItem({
  item,
  /** Ticker whose page this is, so it is not repeated as a cross-mention. */
  currentTicker,
  /** Story summary from the AI layer, for clustered stories only. */
  summary = null,
}: {
  item: FeedItem;
  currentTicker?: string;
  summary?: GeneratedText | null;
}) {
  const others = item.tickers.filter((t) => t !== currentTicker);

  return (
    <article className="border-b border-neutral-100 py-4 last:border-0 dark:border-neutral-900">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <EventBadge item={item} />
        {others.map((t) => (
          <Link
            key={t}
            href={`/company/${t}`}
            className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-neutral-500 transition hover:border-neutral-400 dark:border-neutral-800"
          >
            {t}
          </Link>
        ))}
      </div>

      <h3 className="text-[15px] font-medium leading-snug">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline underline-offset-4"
        >
          {item.title}
        </a>
      </h3>

      {/*
        The summary displaces the snippet rather than joining it. A snippet is
        one outlet's opening line; for a story forty outlets carried, a summary
        of all of them is strictly the better thing to read, and showing both
        would say the same thing twice in two voices.
      */}
      {summary ? (
        <GeneratedNote
          body={summary.body}
          model={summary.model}
          variant="inline"
        />
      ) : (
        item.snippet && (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-neutral-500">
            {item.snippet}
          </p>
        )
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
        <span>{item.publisher ?? item.sourceName}</span>
        <span aria-hidden>·</span>
        <time dateTime={item.publishedAt.toISOString()}>
          {formatRelativeTime(item.publishedAt)}
        </time>
        {item.articleCount > 1 && (
          <>
            <span aria-hidden>·</span>
            {/*
              The dedup result made visible: this story arrived N times and is
              shown once. Linking out rather than expanding inline keeps the
              feed scannable.
            */}
            <Link
              href={`/story/${item.storyId}`}
              className="underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              +{item.articleCount - 1} similar
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
