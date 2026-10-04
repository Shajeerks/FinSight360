/**
 * Background mailbox sync while the app is running (started from
 * instrumentation.ts). Interval from EMAIL_SYNC_INTERVAL_MINUTES (default 60,
 * 0 disables). `npm run sync:email` runs the same thing once from a terminal / cron.
 */
import { logger } from "@/lib/logger";

let timer: ReturnType<typeof setInterval> | null = null;

export async function runEmailSyncOnce() {
  const { syncAllEmailConnections } = await import("@/services/email.service");
  const results = await syncAllEmailConnections();
  if (results.length) logger.info("email_sync_cycle", { mailboxes: results.length, failed: results.filter((r) => !r.ok).length });
  return results;
}

export function startEmailSyncWorker() {
  const minutes = Number(process.env.EMAIL_SYNC_INTERVAL_MINUTES ?? "60");
  if (!Number.isFinite(minutes) || minutes <= 0 || timer) return;
  const g = globalThis as unknown as { __fsEmailWorker?: boolean };
  if (g.__fsEmailWorker) return; // dev hot-reload
  g.__fsEmailWorker = true;
  timer = setInterval(() => {
    runEmailSyncOnce().catch((error) => logger.error("email_sync_cycle_failed", { error }));
  }, Math.max(15, minutes) * 60_000);
  timer.unref?.();
}
