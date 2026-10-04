/**
 * Runs once when the Next.js server starts. Validates the environment so a
 * missing/invalid setting fails fast with a clear message instead of a
 * confusing runtime error later.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/lib/env");
  env();
  if (process.env.NODE_ENV === "test") return;
  try {
    const { startEmailSyncWorker } = await import("@/workers/email-sync");
    startEmailSyncWorker();
  } catch (error) {
    console.warn("Email sync worker not started:", error instanceof Error ? error.message : error);
  }
}
