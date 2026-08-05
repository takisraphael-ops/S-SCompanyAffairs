"use server";

import { revalidatePath } from "next/cache";
import { InvalidRuleError } from "@/alerts/rules";
import type { AlertChannel, AlertKind } from "@/db/schema";
import type { FormState } from "@/lib/form-state";
import {
  AlertError,
  createRule,
  deleteRule,
  markAllRead,
  markRead,
  setRuleEnabled,
} from "@/services/alerts";

const KINDS: AlertKind[] = [
  "price_above",
  "price_below",
  "price_move",
  "new_filing",
  "material_news",
  "keyword",
  "earnings_soon",
];

const CHANNELS: AlertChannel[] = ["inbox", "email"];

/**
 * Turn one flat form into the parameter object a rule kind expects.
 *
 * The form renders every field and hides the ones that do not apply, which
 * keeps it a single uncontrolled form with no client-side branching. That
 * means the submission carries fields belonging to other kinds, so this picks
 * only the ones this kind uses — anything else would be stored in jsonb and
 * come back to confuse the evaluator later.
 */
function paramsFromForm(kind: AlertKind, form: FormData): unknown {
  const str = (k: string) => String(form.get(k) ?? "").trim();

  switch (kind) {
    case "price_above":
    case "price_below":
      return { threshold: str("threshold") };
    case "price_move":
      return { percent: str("percent") };
    case "earnings_soon":
      return { days: str("days") };
    case "material_news":
      return { minMateriality: str("minMateriality") };
    case "new_filing":
      return {
        formTypes: str("formTypes")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case "keyword":
      return {
        terms: str("terms")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
  }
}

export async function createRuleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const kind = String(formData.get("kind") ?? "");
  const channel = String(formData.get("channel") ?? "inbox");
  const ticker = String(formData.get("ticker") ?? "").trim();

  if (!KINDS.includes(kind as AlertKind)) {
    return { status: "error", message: "Choose what to watch for." };
  }
  if (!CHANNELS.includes(channel as AlertChannel)) {
    return { status: "error", message: "Choose where to be told." };
  }

  try {
    await createRule({
      kind: kind as AlertKind,
      // Empty means the whole watchlist, including tickers added later.
      ticker: ticker === "" ? null : ticker,
      params: paramsFromForm(kind as AlertKind, formData),
      channel: channel as AlertChannel,
    });
  } catch (err) {
    // Both of these carry a message written for a person to read.
    if (err instanceof InvalidRuleError || err instanceof AlertError) {
      return { status: "error", message: err.message };
    }
    console.error("create alert rule failed", err);
    return { status: "error", message: "Something went wrong saving that." };
  }

  revalidatePath("/alerts");
  return {
    status: "success",
    // Says "from now on" because that is a genuine surprise otherwise: a rule
    // does not search what is already stored, so a keyword alert created
    // after this morning's news will not surface this morning's news.
    message: `Watching ${ticker ? ticker.toUpperCase() : "your whole watchlist"} from now on. Checked on the next run.`,
  };
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const id = String(formData.get("ruleId") ?? "");
  if (!id) return;

  await setRuleEnabled(id, String(formData.get("enabled") ?? "") === "true");
  revalidatePath("/alerts");
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const id = String(formData.get("ruleId") ?? "");
  if (!id) return;

  await deleteRule(id);
  revalidatePath("/alerts");
}

export async function markReadAction(formData: FormData): Promise<void> {
  const id = String(formData.get("eventId") ?? "");
  if (!id) return;

  await markRead(id);
  // The unread badge is in the layout, so the whole tree has to revalidate.
  revalidatePath("/", "layout");
}

export async function markAllReadAction(): Promise<void> {
  await markAllRead();
  revalidatePath("/", "layout");
}
