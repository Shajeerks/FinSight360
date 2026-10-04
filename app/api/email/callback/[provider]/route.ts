import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getRequestMeta } from "@/lib/security/request";
import { completeConnect, providerFromParam } from "@/services/email.service";

export const dynamic = "force-dynamic";
const OAUTH_COOKIE = "fs_email_oauth";

/** GET /api/email/callback/gmail|outlook — OAuth redirect target. Verifies state + PKCE, stores encrypted tokens. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const base = env().APP_URL;
  const jar = await cookies();
  const cookie = jar.get(OAUTH_COOKIE)?.value;
  let target: string;
  try {
    const user = await requireApiUser();
    const provider = providerFromParam((await params).provider);
    const q = new URL(req.url).searchParams;
    const conn = await completeConnect(user.id, provider, { code: q.get("code"), state: q.get("state"), error: q.get("error"), cookie }, await getRequestMeta());
    target = `${base}/imports/email?connected=${conn.id}`;
  } catch (e) {
    if (!(e instanceof AppError)) logger.error("email_oauth_callback_failed", { error: e });
    target = `${base}/imports/email?error=${encodeURIComponent(e instanceof AppError ? e.code : "OAUTH_FAILED")}`;
  }
  const res = NextResponse.redirect(target);
  res.cookies.set(OAUTH_COOKIE, "", { path: "/api/email/callback", maxAge: 0 });
  return res;
}
