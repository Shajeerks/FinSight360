import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
// Reading mailboxes can take a while; this is the Vercel Hobby maximum.
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily background run for hosted deployments (Vercel Cron — see vercel.json), where the
 * in-process scheduler can't run: email sync (alerts + statements) for every connected
 * mailbox, then the daily jobs (net-worth snapshots, recurring detection, due reminders).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else gets 401.
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out: Record<string, unknown> = {};
  try {
    const { syncAllEmailConnections } = await import("@/services/email.service");
    const r = await syncAllEmailConnections();
    out.email = { mailboxes: r.length, failed: r.filter((x) => !x.ok).length };
  } catch (error) {
    logger.error("cron_email_failed", { error });
    out.email = "failed";
  }
  try {
    const { runDailyJobs } = await import("@/workers/scheduler");
    out.daily = (await runDailyJobs()).skipped ? "already ran today" : "done";
  } catch (error) {
    logger.error("cron_daily_failed", { error });
    out.daily = "failed";
  }
  return NextResponse.json({ ok: true, ...out });
}
