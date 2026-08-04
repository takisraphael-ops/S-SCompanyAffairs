"use client";

import { useFormStatus } from "react-dom";
import { toggleUnderstoodAction } from "@/app/learn/actions";

function Button({ understood }: { understood: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
        understood
          ? "border-transparent bg-up/15 text-up"
          : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      }`}
    >
      {understood ? "✓ Understood" : "Mark as understood"}
    </button>
  );
}

export function UnderstoodToggle({
  conceptId,
  understood,
}: {
  conceptId: string;
  understood: boolean;
}) {
  return (
    <form action={toggleUnderstoodAction}>
      <input type="hidden" name="conceptId" value={conceptId} />
      {/* Submit the desired next state, not the current one. */}
      <input type="hidden" name="understood" value={String(!understood)} />
      <Button understood={understood} />
    </form>
  );
}
