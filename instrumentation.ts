/**
 * Runs once when the Next.js server starts. Validates the environment so a
 * missing/invalid setting fails fast with a clear message instead of a
 * confusing runtime error later.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("@/lib/env");
  env();
  if (process.env.NODE_ENV === "production") {
    const { productionIssues } = await import("@/lib/env");
    const { errors, warnings } = productionIssues();
    for (const w of warnings) console.warn(`[FinSight360] ${w}`);
    if (errors.length) throw new Error(`Refusing to start in production:\n  • ${errors.join("\n  • ")}`);
  }
  if (process.env.NODE_ENV === "test") return;
  try {
    const { startScheduler } = await import("@/workers/scheduler");
    startScheduler();
  } catch (error) {
    console.warn("Background jobs not started:", error instanceof Error ? error.message : error);
  }
}
