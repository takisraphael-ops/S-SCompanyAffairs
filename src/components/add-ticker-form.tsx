"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { addTickerAction } from "@/app/actions";
import { initialFormState } from "@/lib/form-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      {pending ? "Adding…" : "Add"}
    </button>
  );
}

export function AddTickerForm() {
  const [state, formAction] = useActionState(addTickerAction, initialFormState);

  /*
   * Controlled on purpose. React resets uncontrolled fields automatically once
   * a form action settles, which would wipe a rejected symbol before the user
   * could correct the typo. Holding the value here lets us clear on success
   * only.
   *
   * The reset adjusts state during render rather than in an effect — React's
   * documented pattern for reacting to changed input, and it avoids the extra
   * commit-then-rerender pass an effect would cost.
   */
  const [value, setValue] = useState("");
  const [seenState, setSeenState] = useState(state);

  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "success") setValue("");
  }

  return (
    <div className="mb-8">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          name="ticker"
          placeholder="Add a ticker — AAPL, MSFT, NVDA"
          autoComplete="off"
          spellCheck={false}
          aria-label="Ticker symbol"
          className="w-64 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm uppercase placeholder:normal-case placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none dark:border-neutral-700"
        />
        <SubmitButton />
      </form>

      {state.status !== "idle" && state.message && (
        <p
          role="status"
          className={`mt-2 text-sm ${
            state.status === "error"
              ? "text-down"
              : "text-neutral-600 dark:text-neutral-400"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
