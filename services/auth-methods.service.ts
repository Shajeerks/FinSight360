import "server-only";
import { prisma } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { isGoogleAuthEnabled, isMicrosoftAuthEnabled, isRegistrationAllowed } from "@/lib/env";
import type { RequestMeta } from "@/lib/security/request";

export const OAUTH_PROVIDERS = ["google", "microsoft-entra-id"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Google", "microsoft-entra-id": "Microsoft" };

export function isOAuthProvider(p: string): p is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(p);
}

export function providerConfigured(p: OAuthProvider) {
  return p === "google" ? isGoogleAuthEnabled() : isMicrosoftAuthEnabled();
}

/** Every way this user can sign in. */
export async function getAuthMethods(userId: string) {
  const [user, accounts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, passwordHash: true } }),
    prisma.account.findMany({ where: { userId }, select: { provider: true, createdAt: true } }),
  ]);
  return {
    email: user.email,
    hasPassword: Boolean(user.passwordHash),
    providers: OAUTH_PROVIDERS.map((p) => {
      const linked = accounts.find((a) => a.provider === p);
      return { id: p, label: PROVIDER_LABEL[p], configured: providerConfigured(p), linked: Boolean(linked), linkedAt: linked?.createdAt ?? null };
    }),
  };
}

/**
 * Decides whether a Google/Microsoft sign-in may proceed.
 *  • returning user (this provider identity is already linked) → yes
 *  • "add sign-in method" from Settings (valid link token for this user) → yes
 *  • Google with a verified email that matches an existing user → yes (linked by email)
 *  • Microsoft whose email matches an existing user → no: sign in with your existing
 *    method first, then link Microsoft from Settings (Microsoft emails aren't always verified)
 *  • otherwise it would create a NEW account → only when sign-ups are allowed
 * Returns true, or an error code for the login page.
 */
export async function oauthSignInDecision(input: { provider: string; providerAccountId: string; email: string | null; linkingUserId: string | null }): Promise<true | "LinkFromSettings" | "RegistrationClosed"> {
  const existing = await prisma.account.findUnique({ where: { provider_providerAccountId: { provider: input.provider, providerAccountId: input.providerAccountId } }, select: { userId: true } });
  if (existing) return true;
  if (input.linkingUserId) return true;
  const byEmail = input.email ? await prisma.user.findFirst({ where: { email: input.email.toLowerCase() }, select: { id: true } }) : null;
  if (byEmail) return input.provider === "google" ? true : "LinkFromSettings";
  return isRegistrationAllowed() ? true : "RegistrationClosed";
}

/** Remove a sign-in method — never the last one. */
export async function unlinkProvider(userId: string, provider: string, meta: RequestMeta) {
  if (!isOAuthProvider(provider)) throw new AppError("Unknown sign-in method.", 400, "UNKNOWN_PROVIDER");
  const m = await getAuthMethods(userId);
  const target = m.providers.find((p) => p.id === provider);
  if (!target?.linked) throw new AppError(`${PROVIDER_LABEL[provider]} isn't linked to your account.`, 404, "NOT_LINKED");
  const remaining = (m.hasPassword ? 1 : 0) + m.providers.filter((p) => p.linked && p.id !== provider).length;
  if (remaining === 0) throw new AppError("This is your only way to sign in. Set a password first (Security & Sign-in), then remove it.", 409, "LAST_METHOD");
  await prisma.account.deleteMany({ where: { userId, provider } });
  await audit({ userId, action: AuditAction.ACCOUNT_UNLINKED, entityType: "User", entityId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider } });
  try {
    const { notify } = await import("@/services/notification.service");
    await notify(userId, { type: "SECURITY", title: `${PROVIDER_LABEL[provider]} sign-in removed`, body: `${PROVIDER_LABEL[provider]} can no longer be used to sign in to FinSight360. If this wasn't you, change your password now.`, link: "/settings/authentication" });
  } catch {
    /* best effort */
  }
}
