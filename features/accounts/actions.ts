"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction, assertIds } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import {
  createBankAccount, createCashAccount, deleteBankAccount, deleteCashAccount, updateBankAccount, updateCashAccount,
} from "@/services/account.service";

function refresh() {
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

async function ctx() {
  const user = await requireApiUser();
  return { user, meta: await getRequestMeta() };
}

export async function saveBankAccountAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => {
    if (id) await updateBankAccount(user.id, id, input, meta);
    else await createBankAccount(user.id, input, meta);
  }, id ? "Bank account updated." : "Bank account added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteBankAccountAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteBankAccount(user.id, id, meta), "Bank account removed. Its transactions are kept.");
  if (res.ok) refresh();
  return res;
}

export async function saveCashAccountAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => {
    if (id) await updateCashAccount(user.id, id, input, meta);
    else await createCashAccount(user.id, input, meta);
  }, id ? "Cash wallet updated." : "Cash wallet added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteCashAccountAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteCashAccount(user.id, id, meta), "Cash wallet removed.");
  if (res.ok) refresh();
  return res;
}
