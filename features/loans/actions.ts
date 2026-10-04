"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction, assertIds } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { createLoan, deleteLoan, deleteLoanPayment, previewEmi, recordLoanPayment, reviseInterestRate, updateLoanDetails } from "@/services/loan.service";

function refresh(loanId?: string) {
  for (const p of ["/loans", "/dashboard", "/transactions", "/accounts", "/expenses"]) revalidatePath(p);
  if (loanId) revalidatePath(`/loans/${loanId}`);
}

async function ctx() {
  const user = await requireApiUser();
  return { user, meta: await getRequestMeta() };
}

export async function previewEmiAction(input: unknown): Promise<ActionResult<ReturnType<typeof previewEmi>>> {
  await requireApiUser();
  return runAction(async () => previewEmi(input));
}

export async function createLoanAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const { user, meta } = await ctx();
  const res = await runAction(async () => ({ id: (await createLoan(user.id, input, meta)).id }), "Loan added with its full EMI schedule.");
  if (res.ok) refresh();
  return res;
}

export async function updateLoanAction(id: string, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => void (await updateLoanDetails(user.id, id, input, meta)), "Loan updated.");
  if (res.ok) refresh(id);
  return res;
}

export async function deleteLoanAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteLoan(user.id, id, meta), "Loan removed. Payments already in your ledger are kept.");
  if (res.ok) refresh(id);
  return res;
}

export async function recordLoanPaymentAction(loanId: string, input: unknown): Promise<ActionResult> {
  assertIds(loanId);
  const { user, meta } = await ctx();
  const res = await runAction(async () => void (await recordLoanPayment(user.id, loanId, input, meta)), "Payment recorded and schedule updated.");
  if (res.ok) refresh(loanId);
  return res;
}

export async function deleteLoanPaymentAction(loanId: string, paymentId: string): Promise<ActionResult> {
  assertIds(loanId, paymentId);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteLoanPayment(user.id, loanId, paymentId, meta), "Payment removed and schedule re-projected.");
  if (res.ok) refresh(loanId);
  return res;
}

export async function reviseRateAction(loanId: string, input: unknown): Promise<ActionResult> {
  assertIds(loanId);
  const { user, meta } = await ctx();
  const res = await runAction(() => reviseInterestRate(user.id, loanId, input, meta), "Interest rate revised; future EMIs re-calculated.");
  if (res.ok) refresh(loanId);
  return res;
}
