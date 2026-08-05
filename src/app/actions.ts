"use server";

import { revalidatePath } from "next/cache";
import { backfillBars, ingestQuotes, refreshSecurity } from "@/ingest/quotes";
import type { FormState } from "@/lib/form-state";
import {
  InvalidTickerError,
  UnknownTickerError,
} from "@/services/securities";
import { addToWatchlist, removeFromWatchlist } from "@/services/watchlist";

export async function addTickerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = String(formData.get("ticker") ?? "").trim();
  if (!raw) return { status: "error", message: "Enter a ticker symbol." };

  let security;
  try {
    security = await addToWatchlist(raw);
  } catch (err) {
    if (err instanceof InvalidTickerError || err instanceof UnknownTickerError) {
      return { status: "error", message: err.message };
    }
    console.error("add ticker failed", err);
    return {
      status: "error",
      message: "Something went wrong adding that ticker.",
    };
  }

  // Populate the row immediately rather than leaving dashes until the next
  // scheduled run. Both steps are best-effort: the ticker is already on the
  // list and a later ingest will fill any gaps.
  try {
    await refreshSecurity(security.id, security.ticker);
  } catch (err) {
    console.warn(`initial quote fetch failed for ${security.ticker}`, err);
  }

  try {
    await backfillBars(security.id, security.ticker);
  } catch (err) {
    console.warn(`backfill failed for ${security.ticker}`, err);
  }

  revalidatePath("/");
  return {
    status: "success",
    message:
      security.name === security.ticker
        ? `Added ${security.ticker}`
        : `Added ${security.ticker} — ${security.name}`,
  };
}

export async function removeTickerAction(formData: FormData): Promise<void> {
  const securityId = String(formData.get("securityId") ?? "");
  if (!securityId) return;

  await removeFromWatchlist(securityId);
  revalidatePath("/");
}

export async function refreshAllAction(): Promise<void> {
  await ingestQuotes();
  revalidatePath("/");
}
