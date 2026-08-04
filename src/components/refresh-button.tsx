"use client";

import { useFormStatus } from "react-dom";
import { refreshAllAction } from "@/app/actions";

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      {pending ? "Refreshing…" : "Refresh now"}
    </button>
  );
}

export function RefreshButton() {
  return (
    <form action={refreshAllAction}>
      <Button />
    </form>
  );
}
