"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction, assertIds } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { createCreditCard, deleteCreditCard, updateCreditCard } from "@/services/credit-card.service";

function refresh() {
  revalidatePath("/credit-cards");
  revalidatePath("/dashboard");
}

export async function saveCreditCardAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(async () => {
    if (id) await updateCreditCard(user.id, id, input, meta);
    else await createCreditCard(user.id, input, meta);
  }, id ? "Card updated." : "Credit card added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteCreditCardAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => deleteCreditCard(user.id, id, meta), "Card removed. Its transactions are kept.");
  if (res.ok) refresh();
  return res;
}
