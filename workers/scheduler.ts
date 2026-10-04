/**
 * In-process scheduler, started from instrumentation.ts when the server boots.
 *   • every EMAIL_SYNC_INTERVAL_MINUTES (default 60): sync connected mailboxes
 *   • once a day (first tick after midnight IST, and at startup if missed):
 *       net-worth snapshots, recurring-payment detection, reminders and notifications
 * `npm run jobs:daily` runs the daily jobs once from a terminal (or cron).
 * The last daily run is stored in system_settings so restarts don't repeat it.
 */
import { logger } from "@/lib/logger";
import { runEmailSyncOnce } from "@/workers/email-sync";

let started = false;
const TICK_MS = 5 * 60_000;

function istDay(d = new Date()) {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export async function runDailyJobs(force = false) {
  const { prisma } = await import("@/lib/db");
  const today = istDay();
  const last = await prisma.systemSetting.findUnique({ where: { key: "jobs.daily.lastRun" } });
  if (!force && (last?.value as { day?: string } | null)?.day === today) return { skipped: true as const };
  // Claim the day first so two processes don't both run it.
  await prisma.systemSetting.upsert({ where: { key: "jobs.daily.lastRun" }, update: { value: { day: today, at: new Date().toISOString() } }, create: { key: "jobs.daily.lastRun", value: { day: today, at: new Date().toISOString() }, description: "Last run of the daily background jobs" } });
  const results: Record<string, unknown> = {};
  const { snapshotAllUsers } = await import("@/services/networth.service");
  const { detectRecurringForUser } = await import("@/services/recurring.service");
  const { dailyDueRunForAllUsers } = await import("@/services/reminder.service");
  try {
    results.netWorthSnapshots = await snapshotAllUsers();
  } catch (error) {
    logger.error("job_networth_failed", { error });
  }
  try {
    const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
    let found = 0;
    for (const u of users) found += (await detectRecurringForUser(u.id)).created;
    results.recurringDetected = found;
  } catch (error) {
    logger.error("job_recurring_failed", { error });
  }
  try {
    results.reminders = await dailyDueRunForAllUsers();
  } catch (error) {
    logger.error("job_reminders_failed", { error });
  }
  logger.info("daily_jobs_done", results);
  return { skipped: false as const, results };
}

export function startScheduler() {
  const g = globalThis as unknown as { __fsScheduler?: boolean };
  if (started || g.__fsScheduler) return; // dev hot-reload
  started = g.__fsScheduler = true;
  const emailEvery = Number(process.env.EMAIL_SYNC_INTERVAL_MINUTES ?? "60");
  let lastEmail = Date.now();
  const tick = async () => {
    try {
      await runDailyJobs();
    } catch (error) {
      logger.error("daily_jobs_failed", { error });
    }
    if (Number.isFinite(emailEvery) && emailEvery > 0 && Date.now() - lastEmail >= Math.max(15, emailEvery) * 60_000) {
      lastEmail = Date.now();
      await runEmailSyncOnce().catch((error) => logger.error("email_sync_cycle_failed", { error }));
    }
  };
  setTimeout(tick, 30_000).unref?.();
  setInterval(tick, TICK_MS).unref?.();
}
