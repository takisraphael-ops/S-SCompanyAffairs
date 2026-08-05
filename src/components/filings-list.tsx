import { GeneratedNote } from "@/components/generated-note";
import { Term } from "@/components/term";
import { formatRelativeTime } from "@/lib/format";
import { describeForm, isMaterialForm } from "@/lib/forms";
import type { SummarisedFiling } from "@/services/fundamentals";

/**
 * Filings, with every form code translated.
 *
 * "8-K" means nothing to someone who does not already know, so each row leads
 * with what the form actually is. Where P1 authored a concept for the form,
 * the label is a <Term> and explains itself in place.
 *
 * Routine filings — insider forms, plan reports — are collapsed rather than
 * dropped: they are legitimate, just not what you scan a filing list for.
 *
 * Two descriptions can appear under a row, and the difference between them is
 * the point: the authored one says what the form code means, always, for
 * free. The generated one, when the AI ingest has written it, says what
 * filing this particular form at this particular time ordinarily indicates.
 * Neither has read the document, and the second says so.
 */
async function FilingRow({ filing }: { filing: SummarisedFiling }) {
  const info = describeForm(filing.formType);

  return (
    <li className="border-b border-neutral-100 py-3 last:border-0 dark:border-neutral-900">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-700">
          {filing.formType}
        </span>
        <a
          href={filing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {info.concept ? (
            <Term slug={info.concept}>{info.label}</Term>
          ) : (
            info.label
          )}
        </a>
        <span className="text-xs text-neutral-400">
          {formatRelativeTime(filing.filedAt)}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        {info.description}
      </p>
      {filing.summary && filing.summaryModel && (
        <div className="mt-2">
          <GeneratedNote
            body={filing.summary}
            model={filing.summaryModel}
            variant="inline"
          />
        </div>
      )}
    </li>
  );
}

export async function FilingsList({
  filings,
}: {
  filings: SummarisedFiling[];
}) {
  if (filings.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No filings stored yet. These come from SEC EDGAR and need a resolved
        CIK.
      </p>
    );
  }

  const material = filings.filter((f) => isMaterialForm(f.formType));
  const routine = filings.filter((f) => !isMaterialForm(f.formType));

  return (
    <div>
      <ul>
        {material.map((f) => (
          <FilingRow key={f.id} filing={f} />
        ))}
      </ul>

      {routine.length > 0 && (
        <details className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300">
            {routine.length} routine{" "}
            {routine.length === 1 ? "filing" : "filings"} (insider forms, plan
            reports)
          </summary>
          <ul className="mt-2 opacity-70">
            {routine.map((f) => (
              <FilingRow key={f.id} filing={f} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
