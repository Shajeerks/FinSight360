"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction, assertIds, assertBool } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { applyMapping, cancelImport, commitImport, previewMapping, setAllIncluded, undoImport, updateImportRow, type ImportSummary } from "@/services/import.service";
import { resolveDuplicate, resolveReview, scanForDuplicates } from "@/services/duplicate.service";

const LEDGER_PATHS = ["/dashboard", "/transactions", "/accounts", "/credit-cards", "/income", "/expenses", "/analytics", "/imports", "/imports/duplicates", "/imports/review"];

function refreshLedger(importId?: string) {
  for (const p of LEDGER_PATHS) revalidatePath(p);
  if (importId) revalidatePath(`/imports/${importId}`);
}

async function ctx() {
  const user = await requireApiUser();
  return { user, meta: await getRequestMeta() };
}

export async function previewMappingAction(importId: string, input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof previewMapping>>>> {
  assertIds(importId);
  const user = await requireApiUser();
  return runAction(() => previewMapping(user.id, importId, input));
}

export async function applyMappingAction(importId: string, input: unknown): Promise<ActionResult> {
  assertIds(importId);
  const { user, meta } = await ctx();
  const res = await runAction(() => applyMapping(user.id, importId, input, meta), "Rows read and checked for duplicates.");
  if (res.ok) revalidatePath(`/imports/${importId}`);
  return res;
}

export async function updateImportRowAction(importId: string, rowId: string, input: unknown): Promise<ActionResult> {
  assertIds(importId, rowId);
  const user = await requireApiUser();
  const res = await runAction(() => updateImportRow(user.id, importId, rowId, input));
  if (res.ok) revalidatePath(`/imports/${importId}`);
  return res;
}

export async function setAllIncludedAction(importId: string, include: boolean): Promise<ActionResult> {
  assertBool(include);
  assertIds(importId);
  const user = await requireApiUser();
  const res = await runAction(() => setAllIncluded(user.id, importId, include));
  if (res.ok) revalidatePath(`/imports/${importId}`);
  return res;
}

export async function commitImportAction(importId: string): Promise<ActionResult<ImportSummary>> {
  assertIds(importId);
  const { user, meta } = await ctx();
  const res = await runAction(() => commitImport(user.id, importId, meta), "Statement imported.");
  if (res.ok) refreshLedger(importId);
  return res;
}

export async function cancelImportAction(importId: string): Promise<ActionResult> {
  assertIds(importId);
  const { user, meta } = await ctx();
  const res = await runAction(() => cancelImport(user.id, importId, meta), "Import cancelled. Nothing was added.");
  if (res.ok) refreshLedger(importId);
  return res;
}

export async function undoImportAction(importId: string): Promise<ActionResult<{ removed: number; detached: number }>> {
  assertIds(importId);
  const { user, meta } = await ctx();
  const res = await runAction(() => undoImport(user.id, importId, meta), "Import undone and balances restored.");
  if (res.ok) refreshLedger(importId);
  return res;
}

export async function resolveDuplicateAction(candidateId: string, action: string): Promise<ActionResult> {
  assertIds(candidateId);
  const { user, meta } = await ctx();
  const msg: Record<string, string> = { CONFIRM_DUPLICATE: "Marked as duplicate — counted once.", MERGE: "Merged into the original.", KEEP_BOTH: "Kept both transactions.", IGNORE: "Warning dismissed — still waiting in the review queue." };
  const res = await runAction(async () => void (await resolveDuplicate(user.id, candidateId, { action }, meta)), msg[action]);
  if (res.ok) refreshLedger();
  return res;
}

export async function scanDuplicatesAction(): Promise<ActionResult<{ scanned: number; flagged: number }>> {
  const { user, meta } = await ctx();
  const res = await runAction(() => scanForDuplicates(user.id, 120, meta));
  if (res.ok) refreshLedger();
  return res;
}

export async function resolveReviewAction(action: "APPROVE" | "REJECT", ids: string[]): Promise<ActionResult<{ count: number }>> {
  assertIds(ids);
  const { user, meta } = await ctx();
  const res = await runAction(() => resolveReview(user.id, { action, ids }, meta), action === "APPROVE" ? "Approved — now counted in your totals." : "Rejected — kept for audit, never counted.");
  if (res.ok) refreshLedger();
  return res;
}
