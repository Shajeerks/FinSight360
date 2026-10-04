"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { assertIds, runAction } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import {
  addInvestmentTransaction, createHolding, createInvestmentAccount, deleteHolding, deleteInvestmentAccount, deleteInvestmentTransaction, refreshMutualFundNavs, updateHolding, updateHoldingPrice, updateInvestmentAccount,
} from "@/services/investment.service";

function refresh(holdingId?: string) {
  revalidatePath("/investments");
  revalidatePath("/dashboard");
  if (holdingId) revalidatePath(`/investments/${holdingId}`);
}

async function ctx() {
  const user = await requireApiUser();
  return { user, meta: await getRequestMeta() };
}

export async function saveInvestmentAccountAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => void (id ? await updateInvestmentAccount(user.id, id, input, meta) : await createInvestmentAccount(user.id, input, meta)), id ? "Account updated." : "Investment account added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteInvestmentAccountAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteInvestmentAccount(user.id, id, meta), "Account removed from your portfolio.");
  if (res.ok) refresh();
  return res;
}

export async function saveHoldingAction(id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => ({ id: (id ? await updateHolding(user.id, id, input, meta) : await createHolding(user.id, input, meta)).id }), id ? "Holding updated." : "Holding added.");
  if (res.ok) refresh(res.data?.id);
  return res;
}

export async function deleteHoldingAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteHolding(user.id, id, meta), "Holding removed.");
  if (res.ok) refresh(id);
  return res;
}

export async function updatePriceAction(id: string, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => void (await updateHoldingPrice(user.id, id, input, meta)), "Price updated.");
  if (res.ok) refresh(id);
  return res;
}

export async function addInvestmentTxnAction(input: unknown): Promise<ActionResult<{ holdingId: string | null }>> {
  const { user, meta } = await ctx();
  const res = await runAction(async () => ({ holdingId: (await addInvestmentTransaction(user.id, input, meta)).holdingId }), "Transaction added and holding recalculated.");
  if (res.ok) refresh(res.data?.holdingId ?? undefined);
  return res;
}

export async function deleteInvestmentTxnAction(id: string, holdingId: string): Promise<ActionResult> {
  assertIds(id, holdingId);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteInvestmentTransaction(user.id, id, meta), "Transaction removed and holding recalculated.");
  if (res.ok) refresh(holdingId);
  return res;
}

export async function refreshNavsAction(): Promise<ActionResult<{ updated: number; notFound: number; asOf: string | null }>> {
  const { user, meta } = await ctx();
  const res = await runAction(() => refreshMutualFundNavs(user.id, meta));
  if (res.ok) refresh();
  return res;
}
