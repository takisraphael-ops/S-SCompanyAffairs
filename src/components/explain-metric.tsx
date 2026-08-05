"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { explainMetricAction } from "@/app/company/actions";
import { GeneratedNote } from "@/components/generated-note";
import { initialExplainState } from "@/lib/explain-state";

function SubmitButton({ open }: { open: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-expanded={open}
      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      {pending ? "Thinking…" : "Why?"}
    </button>
  );
}

/**
 * "Why is *this* company's figure what it is" — the second half of the
 * explanation design in docs/PLAN.md §3.
 *
 * The hover tooltip beside it answers what the figure *is*, from authored
 * content, for free and instantly. This answers what nobody can write in
 * advance, because it depends on numbers that move.
 *
 * It is a click rather than something that happens on load, and that is a
 * design decision rather than a technical one. A company page carries around
 * thirty figures; generating an explanation for each on every visit would
 * cost real money to answer questions nobody asked, and would put a
 * third-party call inside a page render — the one thing the architecture is
 * arranged to prevent. Once generated, the answer is cached, so the second
 * reader waits for a database round trip rather than a model.
 */
export function ExplainMetric({
  securityId,
  metricKey,
  children,
}: {
  securityId: string;
  metricKey: string;
  /** The figure as displayed. Rendered here, beside the affordance. */
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(
    explainMetricAction,
    initialExplainState,
  );
  const [dismissed, setDismissed] = useState(false);

  const showing = state.status !== "idle" && !dismissed;

  /*
   * Two `dd` elements rather than one, which is why this component renders
   * the figure as well as the button.
   *
   * A definition list may carry several `dd` per `dt`, so the explanation is
   * a second one — conforming markup, and it can take `basis-full` in the
   * row's flex container and so occupy the whole width. Nested inside the
   * value cell it would be a column of one-word lines about forty characters
   * wide, which is not a readable way to present a paragraph.
   */
  return (
    <>
      <dd className="tnum shrink-0 text-sm font-medium">
        {children}
        <form
          action={formAction}
          className="ml-1 inline"
          onSubmit={() => setDismissed(false)}
        >
          <input type="hidden" name="securityId" value={securityId} />
          <input type="hidden" name="metricKey" value={metricKey} />
          <SubmitButton open={showing} />
        </form>
      </dd>

      {showing && (
        <dd className="mt-2 basis-full text-left text-sm font-normal">
          {state.status === "error" ? (
            <p
              role="alert"
              className="rounded-lg border border-down/40 bg-down/5 p-2.5 text-xs text-down"
            >
              {state.message}
            </p>
          ) : (
            <GeneratedNote
              body={state.body}
              model={state.model}
              stale={state.stale}
            />
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-1 text-[11px] text-neutral-400 underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            Hide
          </button>
        </dd>
      )}
    </>
  );
}
