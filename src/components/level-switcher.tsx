"use client";

import { useFormStatus } from "react-dom";
import { changeLevelAction } from "@/app/learn/actions";
import type { ConceptLevel } from "@/db/schema";

const LEVELS: Array<{ value: ConceptLevel; label: string; hint: string }> = [
  { value: "beginner", label: "Beginner", hint: "Explain everything" },
  { value: "intermediate", label: "Intermediate", hint: "Explain the harder ideas" },
  { value: "advanced", label: "Advanced", hint: "Stay out of the way" },
];

function LevelButton({
  value,
  label,
  hint,
  active,
}: {
  value: ConceptLevel;
  label: string;
  hint: string;
  active: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="level"
      value={value}
      disabled={pending}
      title={hint}
      aria-pressed={active}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
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
 * Controls how much scaffolding the UI shows. Without it the app is either
 * cluttered for someone who already knows the vocabulary or impenetrable for
 * someone who does not — one setting cannot serve both.
 */
export function LevelSwitcher({ current }: { current: ConceptLevel }) {
  return (
    <form action={changeLevelAction} className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs text-neutral-500">Explain at:</span>
      {LEVELS.map((l) => (
        <LevelButton key={l.value} {...l} active={l.value === current} />
      ))}
    </form>
  );
}
