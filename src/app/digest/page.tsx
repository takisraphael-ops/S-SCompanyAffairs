import type { Metadata } from "next";
import { ConceptBody } from "@/components/concept-body";
import { GeneratedNote } from "@/components/generated-note";
import { getLatestDigest, listDigestDates } from "@/services/alerts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Digest · S&S Company Affairs",
  description: "What happened to your companies overnight.",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The morning digest, as it was sent.
 *
 * Read from the stored copy rather than rebuilt on load. "What happened
 * overnight" is a question about a moment, and reassembling Tuesday's answer
 * on Thursday from a database that has moved on would quietly show something
 * other than what was delivered.
 */
export default async function DigestPage() {
  const [digest, dates] = await Promise.all([
    getLatestDigest(),
    listDigestDates(),
  ]);

  if (!digest) {
    return (
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Digest</h2>
        <div className="mt-6 rounded-lg border border-dashed border-neutral-300 px-6 py-10 text-center dark:border-neutral-700">
          <p className="text-sm text-neutral-500">
            No digest yet. Run{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
              npm run digest
            </code>{" "}
            or wait for the scheduled job.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {isoDate(digest.forDate)}
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            {digest.itemCount === 0
              ? "A quiet morning."
              : `${digest.itemCount} ${digest.itemCount === 1 ? "item" : "items"} across your watchlist.`}
            {digest.deliveredAt
              ? " Emailed."
              : digest.deliveryError
                ? ` Not emailed: ${digest.deliveryError}`
                : ""}
          </p>
        </div>
        {dates.length > 1 && (
          <p className="text-xs text-neutral-400">
            {dates.length} stored, back to {isoDate(dates[dates.length - 1]!.forDate)}
          </p>
        )}
      </div>

      {digest.summary && (
        <div className="mb-8">
          <GeneratedNote
            body={digest.summary}
            model={digest.summaryModel ?? "unknown"}
          />
        </div>
      )}

      <ConceptBody markdown={digest.body} />
    </div>
  );
}
