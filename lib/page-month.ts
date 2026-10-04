import "server-only";
import { prisma } from "@/lib/db";
import { currentYearMonth, DEFAULT_TIMEZONE, parseYearMonth } from "@/lib/dates";

/** Resolve ?month=YYYY-MM (never in the future) in the user's timezone. */
export async function resolvePageMonth(userId: string, raw: string | string[] | undefined) {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
  const tz = profile?.timezone ?? DEFAULT_TIMEZONE;
  const now = currentYearMonth(tz);
  const requested = parseYearMonth(typeof raw === "string" ? raw : null);
  const ym = requested && requested.year * 12 + requested.month <= now.year * 12 + now.month ? requested : now;
  return { ym, now, tz };
}
