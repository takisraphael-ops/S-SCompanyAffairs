"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createRuleAction } from "@/app/alerts/actions";
import { KIND_INFO } from "@/alerts/rules";
import type { AlertKind } from "@/db/schema";
import { initialFormState } from "@/lib/form-state";

const FIELD =
  "w-full rounded-md border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700";

const KINDS = Object.keys(KIND_INFO) as AlertKind[];

/** Which extra field a kind needs, and how to ask for it. */
const FIELDS: Record<
  AlertKind,
  { name: string; label: string; placeholder: string; hint?: string }
> = {
  price_above: { name: "threshold", label: "Level", placeholder: "200" },
  price_below: { name: "threshold", label: "Level", placeholder: "150" },
  price_move: { name: "percent", label: "Percent", placeholder: "5" },
  earnings_soon: { name: "days", label: "Days ahead", placeholder: "7" },
  material_news: {
    name: "minMateriality",
    label: "Minimum score",
    placeholder: "0.7",
    hint: "0 to 1. An 8-K from a wire scores around 0.85; a listicle scores under 0.1.",
  },
  new_filing: {
    name: "formTypes",
    label: "Form types",
    placeholder: "8-K, 10-Q",
    hint: "Comma separated. Leave empty for anything material.",
  },
  keyword: {
    name: "terms",
    label: "Terms",
    placeholder: "buyback, guidance",
    hint: "Comma separated. Matched whole-word, so “AI” will not match “said”.",
  },
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      {pending ? "Saving…" : "Create alert"}
    </button>
  );
}

/**
 * Creating a rule.
 *
 * Only the field the chosen kind actually uses is rendered — and the others
 * are removed from the DOM rather than hidden, so a threshold typed and then
 * abandoned is not submitted with a keyword rule. The action picks by kind
 * too, so this is defence in depth rather than the only guard.
 *
 * Values are controlled and cleared only on success: a rejected rule stays on
 * screen to be corrected, matching the ledger form.
 */
export function AlertRuleForm({
  tickers,
  emailConfigured,
}: {
  tickers: string[];
  emailConfigured: boolean;
}) {
  const [state, formAction] = useActionState(
    createRuleAction,
    initialFormState,
  );

  const blank = { kind: "price_above" as AlertKind, ticker: "", value: "" };
  const [values, setValues] = useState(blank);
  const [seenState, setSeenState] = useState(state);

  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "success") {
      setValues((v) => ({ ...blank, kind: v.kind, ticker: v.ticker }));
    }
  }

  const field = FIELDS[values.kind];
  const info = KIND_INFO[values.kind];

  return (
    <div>
      <form action={formAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Company</span>
          <select
            name="ticker"
            value={values.ticker}
            onChange={(e) => setValues((v) => ({ ...v, ticker: e.target.value }))}
            className={FIELD}
          >
            {/* Default to the whole watchlist: it is the option that keeps
                working when a ticker is added next week. */}
            <option value="">Anything on my watchlist</option>
            {tickers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Tell me when</span>
          <select
            name="kind"
            value={values.kind}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                kind: e.target.value as AlertKind,
                // Cleared on purpose: "200" means a price under one kind and
                // a percentage under another.
                value: "",
              }))
            }
            className={FIELD}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_INFO[k].label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">
            {field.label}
          </span>
          <input
            name={field.name}
            value={values.value}
            onChange={(e) => setValues((v) => ({ ...v, value: e.target.value }))}
            placeholder={field.placeholder}
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Tell me by</span>
          <select name="channel" className={FIELD} defaultValue="inbox">
            <option value="inbox">This page</option>
            <option value="email">
              Email{emailConfigured ? "" : " (not configured)"}
            </option>
          </select>
        </label>

        <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-3">
          <SubmitButton />
          <p className="text-xs text-neutral-400">
            {info.hint}
            {field.hint ? ` ${field.hint}` : ""}
          </p>
        </div>
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
