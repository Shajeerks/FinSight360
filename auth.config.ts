import type { NextAuthConfig } from "next-auth";

/**
 * Edge/proxy-safe Auth.js configuration (no database imports).
 * The full configuration with providers + Prisma lives in `auth.ts`.
 */
export const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/offline"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/health"];

const sessionHours = Number(process.env.SESSION_MAX_AGE_HOURS ?? 168);

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

export default {
  pages: { signIn: "/login", error: "/login" },
  session: {
    strategy: "jwt",
    maxAge: (Number.isFinite(sessionHours) && sessionHours > 0 ? sessionHours : 168) * 3600,
    updateAge: 24 * 3600,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (isPublicPath(pathname)) return true;
      if (auth?.user) return true;
      if (pathname.startsWith("/api/")) {
        return Response.json({ error: { code: "UNAUTHORIZED", message: "Please sign in to continue." } }, { status: 401 });
      }
      return false; // → redirect to pages.signIn with callbackUrl
    },
  },
} satisfies NextAuthConfig;
