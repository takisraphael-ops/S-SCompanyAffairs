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

  // Set by the "Add anyway" control, which only appears after a refusal the
  // user is entitled to overrule.
  const force = formData.get("force") === "1";

  let security;
  try {
    security = await addToWatchlist(raw, { force });
  } catch (err) {
    if (err instanceof UnknownTickerError) {
      /*
       * Not a dead end. EDGAR only knows SEC registrants, so a London or
       * Frankfurt listing lands here through no fault of the user's — and the
       * app cannot tell that case apart from a typo. Say what happened, and
       * let them decide, rather than deciding for them.
       */
      return {
        status: "error",
        message: err.message,
        unrecognised: raw.toUpperCase(),
      };
    }
    if (err instanceof InvalidTickerError) {
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

  /*
   * A forced add says what was actually created. The row exists, but nothing
   * identified the company, so there is no name, no filings and no
   * fundamentals behind it — and a bare "Added GAW" would leave the user to
   * discover that by finding an empty company page.
   */
  if (security.name === security.ticker) {
    return {
      status: "success",
      message:
        `Added ${security.ticker}, unverified. No source recognised it, so ` +
        `there is no company name, filings or financials — prices will appear ` +
        `if your quote provider knows the symbol.`,
    };
  }

  return { status: "success", message: `Added ${security.ticker} — ${security.name}` };
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
