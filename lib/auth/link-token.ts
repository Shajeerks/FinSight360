import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Add a sign-in method" intent. Set (httpOnly) by an authenticated server action
 * just before redirecting to Google/Microsoft; checked in the sign-in callback so a
 * new provider can only be attached while you are signed in — and so linking still
 * works when new sign-ups are turned off.
 */
export const LINK_COOKIE = "fs360.link";
const TTL_MS = 10 * 60_000;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not configured");
  return s;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(`link:${payload}`).digest("base64url");
}

export function createLinkToken(userId: string, provider: string, now = Date.now()) {
  const payload = `${userId}.${provider}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the user id when the token is genuine, unexpired and for this provider. */
export function verifyLinkToken(token: string | undefined | null, provider: string, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, p, exp, sig] = parts;
  const expected = Buffer.from(sign(`${userId}.${p}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (p !== provider || !/^\d+$/.test(exp) || Number(exp) < now) return null;
  return userId;
}
