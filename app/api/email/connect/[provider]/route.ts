import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { providerFromParam, startConnect } from "@/services/email.service";

export const dynamic = "force-dynamic";
const OAUTH_COOKIE = "fs_email_oauth";

/** GET /api/email/connect/gmail|outlook — sends the browser to the provider's consent screen (read-only access). */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const base = env().APP_URL;
  try {
    const user = await requireApiUser();
    const provider = providerFromParam((await params).provider);
    const { url, cookie } = startConnect(user.id, provider);
    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: base.startsWith("https://"), path: "/api/email/callback", maxAge: 600 });
    return res;
  } catch (e) {
    const code = e instanceof AppError ? e.code : "ERROR";
    return NextResponse.redirect(`${base}/imports/email?error=${encodeURIComponent(code)}`);
  }
}
