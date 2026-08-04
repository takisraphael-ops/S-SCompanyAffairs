"use server";

import { revalidatePath } from "next/cache";
import type { CostBasisMethod, TransactionKind } from "@/db/schema";
import type { FormState } from "@/lib/form-state";
import {
  LedgerError,
  deleteTransaction,
  recordTransaction,
  setCostBasisMethod,
} from "@/services/portfolio";

const KINDS: TransactionKind[] = [
  "buy",
  "sell",
  "dividend",
  "transfer_in",
  "transfer_out",
];

const METHODS: CostBasisMethod[] = ["fifo", "average"];

export async function recordTransactionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ticker = String(formData.get("ticker") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const tradeDate = String(formData.get("tradeDate") ?? "");
  const quantity = String(formData.get("quantity") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  const fees = String(formData.get("fees") ?? "").trim();

  if (!ticker) return { status: "error", message: "Enter a ticker." };
  if (!KINDS.includes(kind as TransactionKind)) {
    return { status: "error", message: "Choose a transaction type." };
  }
  if (!quantity || !price) {
    return { status: "error", message: "Quantity and price are both required." };
  }

  const parsedDate = tradeDate ? new Date(`${tradeDate}T00:00:00Z`) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    return { status: "error", message: "That trade date is not valid." };
  }

  try {
    await recordTransaction({
      ticker,
      kind: kind as TransactionKind,
      tradeDate: parsedDate,
      quantity,
      price,
      fees,
      notes: String(formData.get("notes") ?? ""),
    });
  } catch (err) {
    // Ledger and decimal-parse failures are user-correctable input problems.
    if (err instanceof LedgerError) {
      return { status: "error", message: err.message };
    }
    if (err instanceof Error && /not a decimal/.test(err.message)) {
      return {
        status: "error",
        message: "Quantity, price and fees must be plain numbers.",
      };
    }
    console.error("record transaction failed", err);
    return { status: "error", message: "Something went wrong recording that." };
  }

  revalidatePath("/portfolio");
  return {
    status: "success",
    message: `Recorded ${kind.replace("_", " ")} of ${quantity} ${ticker.toUpperCase()}`,
  };
}

export async function deleteTransactionAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("transactionId") ?? "");
  if (!id) return;

  await deleteTransaction(id);
  revalidatePath("/portfolio");
}

export async function changeCostBasisMethodAction(
  formData: FormData,
): Promise<void> {
  const method = String(formData.get("method") ?? "");
  if (!METHODS.includes(method as CostBasisMethod)) return;

  await setCostBasisMethod(method as CostBasisMethod);
  revalidatePath("/portfolio");
}
