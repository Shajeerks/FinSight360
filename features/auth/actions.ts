"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { runAction, zodFieldErrors } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { isGoogleAuthEnabled } from "@/lib/env";
import { loginSchema } from "@/validators/auth";
import {
  registerUser,
  requestPasswordReset,
  resetPassword,
} from "@/services/auth.service";
import { safeCallbackUrl } from "@/features/auth/callback-url";

const GENERIC_LOGIN_ERROR =
  "Incorrect email or password. After 5 failed attempts the account is locked for 15 minutes.";

export async function loginAction(input: unknown, callbackUrl?: string | null): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  try {
    await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: GENERIC_LOGIN_ERROR };
    throw error;
  }
  return { ok: true, data: { redirectTo: safeCallbackUrl(callbackUrl) } };
}

export async function registerAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const meta = await getRequestMeta();
  const result = await runAction(() => registerUser(input, meta));
  if (!result.ok) return result;
  const creds = input as { email: string; password: string };
  try {
    await signIn("credentials", { email: creds.email, password: creds.password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // e.g. REQUIRE_EMAIL_VERIFICATION=true — account exists but must be verified first.
      return { ok: true, data: { redirectTo: "/login?registered=1" }, message: "Account created. Please verify your email, then sign in." };
    }
    throw error;
  }
  return { ok: true, data: { redirectTo: "/dashboard" }, message: "Welcome to FinSight360!" };
}

export async function forgotPasswordAction(input: unknown): Promise<ActionResult> {
  const meta = await getRequestMeta();
  const result = await runAction(() => requestPasswordReset(input, meta));
  if (!result.ok && result.fieldErrors) return result;
  // Same response whether or not the account exists.
  return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  const meta = await getRequestMeta();
  return runAction(() => resetPassword(input, meta), "Password updated. Please sign in with your new password.");
}

export async function googleSignInAction(formData: FormData) {
  if (!isGoogleAuthEnabled()) redirect("/login?error=GoogleNotConfigured");
  await signIn("google", { redirectTo: safeCallbackUrl(formData.get("callbackUrl")?.toString()) });
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login?signedOut=1" });
}
