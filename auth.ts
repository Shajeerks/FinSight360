import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import authConfig from "@/auth.config";
import { prisma } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { isGoogleAuthEnabled } from "@/lib/env";
import {
  authenticateWithPassword,
  getSessionState,
  recordSuccessfulLogin,
  secureUnverifiedAccountForOAuth,
} from "@/services/auth.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import type { RequestMeta } from "@/lib/security/request";
import { clientIpFromHeaders } from "@/lib/security/client-ip";

function metaFromRequest(req?: Request): RequestMeta {
  const h = req?.headers;
  return {
    ip: clientIpFromHeaders(h),
    userAgent: h?.get("user-agent")?.slice(0, 300) ?? null,
  };
}

const providers: NextAuthConfig["providers"] = [
  Credentials({
    id: "credentials",
    name: "Email and password",
    credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
    async authorize(credentials, request) {
      const user = await authenticateWithPassword(credentials, metaFromRequest(request));
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role, sessionVersion: user.sessionVersion };
    },
  }),
];

if (isGoogleAuthEnabled()) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Google only returns verified addresses, so linking a Google login to an
      // existing email/password account with the same address is safe here.
      allowDangerousEmailAccountLinking: true,
      // Sign-in only needs identity scopes. Gmail access is requested separately
      // (Phase 5) with its own explicit consent.
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
  );
}
// Extension point: Microsoft Entra ID (Outlook) can be added here later via
// `next-auth/providers/microsoft-entra-id` using MICROSOFT_CLIENT_ID/SECRET.

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") return true;
      // Only trust OAuth identities whose email the provider has verified.
      if (account?.provider === "google" && profile?.email_verified !== true) return false;
      if (user?.id) {
        const state = await getSessionState(user.id);
        if (state && state.status !== "ACTIVE") return false;
      }
      // Pre-account-takeover protection: if someone registered this email with a
      // password but never proved they own the mailbox, the verified OAuth owner
      // takes over — the unverified password is removed and its sessions revoked.
      if (profile?.email) await secureUnverifiedAccountForOAuth(String(profile.email));
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        const u = user as { role?: string; sessionVersion?: number };
        if (u.sessionVersion === undefined) {
          const state = await getSessionState(user.id);
          token.sv = state?.sessionVersion ?? 1;
          token.role = state?.role ?? "USER";
        } else {
          token.sv = u.sessionVersion;
          token.role = u.role ?? "USER";
        }
        return token;
      }
      // Every subsequent request: confirm the account is still active and the
      // session hasn't been revoked ("sign out everywhere" / password change).
      if (!token.sub) return null;
      const state = await getSessionState(token.sub);
      if (!state || state.status !== "ACTIVE" || state.sessionVersion !== token.sv) return null;
      token.name = state.name;
      token.email = state.email;
      token.picture = state.image;
      token.role = state.role;
      return token;
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
        session.user.role = (token.role as string) ?? "USER";
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account, profile }) {
      if (!user.id) return;
      if (account?.provider === "google" && profile?.email_verified) {
        await prisma.user.updateMany({ where: { id: user.id, emailVerified: null }, data: { emailVerified: new Date() } });
      }
      // Credentials logins are audited (with IP) inside authenticateWithPassword.
      if (account?.provider !== "credentials") {
        await recordSuccessfulLogin(user.id, account?.provider ?? "unknown", { ip: null, userAgent: null });
      }
    },
    async signOut(message) {
      const userId = "token" in message ? message.token?.sub : undefined;
      await audit({ userId: userId ?? null, action: AuditAction.LOGOUT, entityType: "User", entityId: userId ?? undefined });
    },
    async createUser({ user }) {
      // OAuth sign-up: create profile & default settings.
      if (!user.id) return;
      await prisma.$transaction((tx) => seedDefaultsForUser(tx, user.id!));
      await audit({ userId: user.id, action: AuditAction.REGISTER, entityType: "User", entityId: user.id, metadata: { provider: "oauth" } });
    },
  },
});
