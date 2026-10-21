"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { requireApiUser, requireUser } from "@/lib/auth/session";
import { assertIds, runAction } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { createLinkToken, LINK_COOKIE } from "@/lib/auth/link-token";
import { deleteImportTemplate, renameImportTemplate, savePreferences } from "@/services/settings.service";
import { isOAuthProvider, providerConfigured, unlinkProvider } from "@/services/auth-methods.service";

export async function savePreferencesAction(input: unknown): Promise<ActionResult> {
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => savePreferences(user.id, input, meta), "Settings saved.");
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function renameTemplateAction(id: string, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => renameImportTemplate(user.id, id, input, meta), "Template renamed.");
  if (res.ok) revalidatePath("/settings/import-templates");
  return res;
}

export async function deleteTemplateAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => deleteImportTemplate(user.id, id, meta), "Template deleted. Past imports are unchanged.");
  if (res.ok) revalidatePath("/settings/import-templates");
  return res;
}

/** Add Google / Microsoft as a sign-in method for the signed-in user. */
export async function linkMethodAction(formData: FormData) {
  const user = await requireUser();
  const provider = String(formData.get("provider") ?? "");
  if (!isOAuthProvider(provider) || !providerConfigured(provider)) redirect("/settings/authentication?error=not-configured");
  const jar = await cookies();
  jar.set(LINK_COOKIE, createLinkToken(user.id, provider), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  await signIn(provider, { redirectTo: `/settings/authentication?linked=${provider}` });
}

export async function unlinkMethodAction(provider: string): Promise<ActionResult> {
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => unlinkProvider(user.id, provider, meta), "Sign-in method removed.");
  if (res.ok) revalidatePath("/settings/authentication");
  return res;
}
