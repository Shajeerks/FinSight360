import NextAuth from "next-auth";
import authConfig from "@/auth.config";

/**
 * Route protection (Next.js 16 "proxy", formerly middleware).
 * Unauthenticated page requests → /login; unauthenticated API calls → 401 JSON.
 * Every page and API handler ALSO verifies the session server-side
 * (defence in depth — the proxy is never the only check).
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    // Everything except Next internals, static assets and PWA files.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|icons/|robots.txt).*)",
  ],
};
