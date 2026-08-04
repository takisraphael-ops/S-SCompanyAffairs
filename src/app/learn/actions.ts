"use server";

import { revalidatePath } from "next/cache";
import type { ConceptLevel } from "@/db/schema";
import { setUnderstood, setUserLevel } from "@/services/concepts";

const LEVELS: ConceptLevel[] = ["beginner", "intermediate", "advanced"];

export async function changeLevelAction(formData: FormData): Promise<void> {
  const raw = String(formData.get("level") ?? "");
  // Never trust a form value straight into an enum column.
  if (!LEVELS.includes(raw as ConceptLevel)) return;

  await setUserLevel(raw as ConceptLevel);

  // The level changes how terms render everywhere, not just on /learn.
  revalidatePath("/", "layout");
}

export async function toggleUnderstoodAction(formData: FormData): Promise<void> {
  const conceptId = String(formData.get("conceptId") ?? "");
  const understood = String(formData.get("understood") ?? "") === "true";
  if (!conceptId) return;

  await setUnderstood(conceptId, understood);
  revalidatePath("/learn", "layout");
}
