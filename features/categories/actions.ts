"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction, assertIds, assertBool } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { createCategory, createSubCategory, deleteCategory, deleteSubCategory, updateCategory } from "@/services/category.service";
import { applyRulesToUncategorized, createRule, deleteRule, setRuleActive, updateRule } from "@/services/rule.service";

function refresh() {
  for (const p of ["/settings/categories", "/settings/rules", "/transactions", "/expenses", "/income"]) revalidatePath(p);
}

async function ctx() {
  const user = await requireApiUser();
  return { user, meta: await getRequestMeta() };
}

export async function saveCategoryAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => {
    if (id) await updateCategory(user.id, id, input, meta);
    else await createCategory(user.id, input, meta);
  }, id ? "Category updated." : "Category added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteCategory(user.id, id, meta), "Category removed.");
  if (res.ok) refresh();
  return res;
}

export async function addSubCategoryAction(input: unknown): Promise<ActionResult> {
  const { user, meta } = await ctx();
  const res = await runAction(async () => void (await createSubCategory(user.id, input, meta)), "Sub-category added.");
  if (res.ok) refresh();
  return res;
}

export async function deleteSubCategoryAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteSubCategory(user.id, id, meta), "Sub-category removed.");
  if (res.ok) refresh();
  return res;
}

export async function saveRuleAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(async () => {
    if (id) await updateRule(user.id, id, input, meta);
    else await createRule(user.id, input, meta);
  }, id ? "Rule updated." : "Rule added.");
  if (res.ok) refresh();
  return res;
}

export async function toggleRuleAction(id: string, isActive: boolean): Promise<ActionResult> {
  assertBool(isActive);
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => setRuleActive(user.id, id, isActive, meta), isActive ? "Rule enabled." : "Rule paused.");
  if (res.ok) refresh();
  return res;
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const { user, meta } = await ctx();
  const res = await runAction(() => deleteRule(user.id, id, meta), "Rule deleted.");
  if (res.ok) refresh();
  return res;
}

export async function applyRulesAction(): Promise<ActionResult<number>> {
  const { user, meta } = await ctx();
  const res = await runAction(() => applyRulesToUncategorized(user.id, meta));
  if (res.ok) {
    refresh();
    return { ok: true, data: res.data, message: `${res.data} uncategorized transaction${res.data === 1 ? "" : "s"} categorized.` };
  }
  return res;
}
