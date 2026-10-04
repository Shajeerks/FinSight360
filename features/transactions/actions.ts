"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction, assertIds } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { createTransaction, deleteTransaction, getTransaction, toFormValues, updateTransaction, type TransactionFormValues } from "@/services/transaction.service";

function refresh() {
  for (const p of ["/transactions", "/income", "/expenses", "/accounts", "/credit-cards", "/dashboard"]) revalidatePath(p);
}

export async function saveTransactionAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(async () => {
    if (id) await updateTransaction(user.id, id, input, meta);
    else await createTransaction(user.id, input, meta);
  }, id ? "Transaction updated." : "Transaction added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => deleteTransaction(user.id, id, meta), "Transaction deleted.");
  if (res.ok) refresh();
  return res;
}

/** Loads a transaction's editable values (client-safe strings). */
export async function loadTransactionAction(id: string): Promise<ActionResult<TransactionFormValues>> {
  assertIds(id);
  const user = await requireApiUser();
  return runAction(async () => toFormValues(await getTransaction(user.id, id)));
}
