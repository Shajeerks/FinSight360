"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { assertIds, runAction } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { deleteBudget, saveBudget } from "@/services/budget.service";
import { detectRecurringForUser, updateRecurring } from "@/services/recurring.service";
import { recordNetWorthSnapshot } from "@/services/networth.service";

function refresh() {
  revalidatePath("/analytics");
  revalidatePath("/dashboard");
}

export async function saveBudgetAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(async () => void (await saveBudget(user.id, id, input, meta)), id ? "Budget updated." : "Budget added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteBudgetAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => deleteBudget(user.id, id, meta), "Budget removed.");
  if (res.ok) refresh();
  return res;
}

export async function updateRecurringAction(id: string, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(async () => void (await updateRecurring(user.id, id, input, meta)), "Saved.");
  if (res.ok) refresh();
  return res;
}

export async function detectRecurringAction(): Promise<ActionResult<{ created: number; updated: number }>> {
  const user = await requireApiUser();
  const res = await runAction(async () => {
    const r = await detectRecurringForUser(user.id);
    await recordNetWorthSnapshot(user.id);
    return { created: r.created, updated: r.updated };
  });
  if (res.ok) refresh();
  return res;
}
