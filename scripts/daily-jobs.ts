/**
 * Run the daily background jobs once:  npm run jobs:daily
 * (net-worth snapshots, recurring detection, reminders & notifications)
 */
import "dotenv/config";
import { runDailyJobs } from "@/workers/scheduler";

runDailyJobs(true)
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error("Daily jobs failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
