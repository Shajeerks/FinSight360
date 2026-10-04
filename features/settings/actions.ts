"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { runAction } from "@/lib/api";
import type { ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { updateProfile } from "@/services/profile.service";
import { changePassword, revokeAllSessions, sendVerificationEmail } from "@/services/auth.service";
import { userRepository } from "@/repositories/user.repository";
import { logoutAction } from "@/features/auth/actions";

export async function updateProfileAction(input: unknown): Promise<ActionResult> {
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => updateProfile(user.id, input, meta), "Profile saved.");
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function changePasswordAction(input: unknown): Promise<ActionResult> {
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => changePassword(user.id, input, meta));
  if (!res.ok) return res;
  // Password change revokes every session, including this one.
  await logoutAction();
  return { ok: true };
}

export async function revokeAllSessionsAction(): Promise<ActionResult> {
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => revokeAllSessions(user.id, meta));
  if (!res.ok) return res;
  await logoutAction();
  return { ok: true };
}

export async function resendVerificationAction(): Promise<ActionResult> {
  const user = await requireApiUser();
  return runAction(async () => {
    const u = await userRepository.findById(user.id);
    if (u) await sendVerificationEmail(u);
  }, "Verification email sent.");
}
