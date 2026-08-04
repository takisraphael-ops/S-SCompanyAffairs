"use client";

import { useFormStatus } from "react-dom";
import { changeCostBasisMethodAction } from "@/app/portfolio/actions";
import type { CostBasisMethod } from "@/db/schema";

function MethodButton({
  value,
  label,
  active,
}: {
  value: CostBasisMethod;
  label: string;
  active: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="method"
      value={value}
      disabled={pending}
      aria-pressed={active}
      className={`rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
        active
          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
          : "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Which shares are treated as sold. The choice moves value between realised
 * and unrealised — and therefore the tax bill — without changing total return.
 */
export function MethodSwitcher({ current }: { current: CostBasisMethod }) {
  return (
    <form
      action={changeCostBasisMethodAction}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="mr-1 text-xs text-neutral-500">Cost basis:</span>
      <MethodButton value="fifo" label="FIFO" active={current === "fifo"} />
      <MethodButton
        value="average"
        label="Average"
        active={current === "average"}
      />
    </form>
  );
}
