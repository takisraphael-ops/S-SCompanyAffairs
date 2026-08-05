"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordTransactionAction } from "@/app/portfolio/actions";
import { initialFormState } from "@/lib/form-state";

const FIELD =
  "w-full rounded-md border border-neutral-300 bg-transparent px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-700";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      {pending ? "Recording…" : "Record"}
    </button>
  );
}

/**
 * Ledger entry.
 *
 * Fields are controlled and cleared only on success, so a rejected entry —
 * selling more than you hold, a mistyped number — stays on screen to be
 * corrected rather than being wiped by React's automatic form reset.
 */
export function TransactionForm({ tickers }: { tickers: string[] }) {
  const [state, formAction] = useActionState(
    recordTransactionAction,
    initialFormState,
  );

  const blank = {
    ticker: tickers[0] ?? "",
    kind: "buy",
    tradeDate: "",
    quantity: "",
    price: "",
    fees: "",
  };
  const [values, setValues] = useState(blank);
  const [seenState, setSeenState] = useState(state);

  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "success") {
      setValues({ ...blank, ticker: values.ticker, kind: values.kind });
    }
  }

  const set = (key: keyof typeof blank) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  return (
    <div>
      <form
        action={formAction}
        className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Ticker</span>
          {tickers.length > 0 ? (
            <select
              name="ticker"
              value={values.ticker}
              onChange={(e) => set("ticker")(e.target.value)}
              className={FIELD}
            >
              {tickers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <input
              name="ticker"
              value={values.ticker}
              onChange={(e) => set("ticker")(e.target.value)}
              placeholder="AAPL"
              className={FIELD}
            />
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Type</span>
          <select
            name="kind"
            value={values.kind}
            onChange={(e) => set("kind")(e.target.value)}
            className={FIELD}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="dividend">Dividend</option>
            <option value="transfer_in">Transfer in</option>
            <option value="transfer_out">Transfer out</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Date</span>
          <input
            type="date"
            name="tradeDate"
            value={values.tradeDate}
            onChange={(e) => set("tradeDate")(e.target.value)}
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">
            {values.kind === "dividend" ? "Shares held" : "Quantity"}
          </span>
          <input
            name="quantity"
            inputMode="decimal"
            value={values.quantity}
            onChange={(e) => set("quantity")(e.target.value)}
            placeholder="100"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">
            {values.kind === "dividend" ? "Per share" : "Price"}
          </span>
          <input
            name="price"
            inputMode="decimal"
            value={values.price}
            onChange={(e) => set("price")(e.target.value)}
            placeholder="150.25"
            className={FIELD}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">
            Fees / tax
          </span>
          <input
            name="fees"
            inputMode="decimal"
            value={values.fees}
            onChange={(e) => set("fees")(e.target.value)}
            placeholder="0"
            className={FIELD}
          />
        </label>

        <div className="sm:col-span-3 lg:col-span-6">
          <SubmitButton />
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
