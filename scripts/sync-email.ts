/**
 * One-off sync of every connected mailbox:  npm run sync:email
 * (Use with cron / launchd if the app isn't kept running.)
 */
import "dotenv/config";
import { runEmailSyncOnce } from "@/workers/email-sync";

runEmailSyncOnce()
  .then((r) => {
    for (const x of r) console.log(x.ok ? `✓ ${x.id}: ${JSON.stringify(x.summary)}` : `✗ ${x.id}: ${x.error}`);
    if (!r.length) console.log("No connected mailboxes.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Sync failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
