"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction, assertIds } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import {
  applyEmiToLoan,
  applyMatchedEmis,
  createDebtLender,
  deleteDebtLender,
  saveDebtEntry,
  undoDebtExcel,
  updateDebtLender,
} from "@/services/debt-tracker.service";

function refresh(withLoans = false) {
  revalidatePath("/debt-tracker");
  if (withLoans) for (const p of ["/loans", "/dashboard", "/transactions", "/expenses"]) revalidatePath(p);
}

async function ctx() {
  const user = await requireApiUser();
  return { user, meta: await getRequestMeta() };
}

export async function saveDebtEntryAction(input: unknown): Promise<ActionResult> {
  const { user, meta } = await ctx();
  const res = await runAction(() => saveDebtEntry(user.id, input, meta), "Saved. Later months are re-calculated from this.");
  if (res.ok) refresh();
  return res;
}

export async function applyEmiAction(loanId: string, transactionId: string): Promise<ActionResult> {
  assertIds(loanId, transactionId);
  const { user, meta } = await ctx();
  const res = await runAction(async () => void (await applyEmiToLoan(user.id, { loanId, transactionId }, meta)), "EMI applied to the loan — principal and interest updated.");
  if (res.ok) refresh(true);
  return res;
}

export async function applyAllEmisAction(month: string): Promise<ActionResult<{ applied: number; failed: string[] }>> {
  const { user, meta } = await ctx();
  const res = await runAction(() => applyMatchedEmis(user.id, month, meta));
  if (res.ok) refresh(true);
  return res;
}

export async function saveDebtLenderAction(id: string | null, input: unknown): Promise<ActionResult> {
  if (id) assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => void (id ? await updateDebtLender(user.id, id, input, meta) : await createDebtLender(user.id, input, meta)), id ? "Lender updated." : "Lender added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteDebtLenderAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteDebtLender(user.id, id, meta), "Lender removed. Your transactions are not affected.");
  if (res.ok) refresh();
  return res;
}

export async function undoDebtExcelAction(): Promise<ActionResult<number>> {
  const { user, meta } = await ctx();
  const res = await runAction(() => undoDebtExcel(user.id, meta));
  if (res.ok) refresh();
  return res;
}
