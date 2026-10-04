"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { assertBool, assertIds, runAction } from "@/lib/api";
import { AppError, type ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { limiters } from "@/lib/security/rate-limit";
import { disconnectEmail, previewAlert, resolveEmailCandidate, retryPendingEmailCandidates, syncEmailConnection, type SyncSummary } from "@/services/email.service";

function refresh() {
  for (const p of ["/imports/email", "/imports/review", "/imports/duplicates", "/transactions", "/dashboard", "/accounts", "/credit-cards", "/expenses", "/income"]) revalidatePath(p);
}

export async function syncEmailAction(id: string, days?: number): Promise<ActionResult<SyncSummary>> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(async () => {
    const rl = await limiters.emailSync.check(`email-sync:${user.id}`);
    if (!rl.allowed) throw new AppError(`Please wait ${rl.retryAfterSeconds}s before syncing again.`, 429, "RATE_LIMITED");
    return syncEmailConnection(user.id, id, { days: days ?? 60 }, meta);
  });
  refresh();
  return res;
}

export async function disconnectEmailAction(id: string, deleteData: boolean): Promise<ActionResult> {
  assertIds(id);
  assertBool(deleteData);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => disconnectEmail(user.id, id, { deleteData }, meta), "Mailbox disconnected and access revoked.");
  refresh();
  return res;
}

export async function resolveEmailCandidateAction(id: string, action: "APPROVE" | "REJECT", account?: string | null): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const res = await runAction(async () => void (await resolveEmailCandidate(user.id, id, { action, account }, await getRequestMeta())), action === "APPROVE" ? "Added to your transactions." : "Alert ignored.");
  if (res.ok) refresh();
  return res;
}

export async function retryEmailCandidatesAction(): Promise<ActionResult<{ placed: number; remaining: number }>> {
  const user = await requireApiUser();
  const res = await runAction(() => retryPendingEmailCandidates(user.id));
  if (res.ok) refresh();
  return res;
}

export async function previewAlertAction(input: unknown): Promise<ActionResult<ReturnType<typeof previewAlert>>> {
  await requireApiUser();
  return runAction(async () => previewAlert(input));
}
