/**
 * Mailbox sync for every connected account. Scheduled by workers/scheduler.ts
 * (EMAIL_SYNC_INTERVAL_MINUTES, default 60; 0 disables). `npm run sync:email`
 * runs it once from a terminal / cron.
 */
import { logger } from "@/lib/logger";

export async function runEmailSyncOnce() {
  const { syncAllEmailConnections } = await import("@/services/email.service");
  const results = await syncAllEmailConnections();
  if (results.length) logger.info("email_sync_cycle", { mailboxes: results.length, failed: results.filter((r) => !r.ok).length });
  return results;
}
