import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { previewAlert } from "@/services/email.service";

export const dynamic = "force-dynamic";

/** POST /api/email/parse — { from, subject, text }: what FinSight360 would read from an alert. Nothing is saved. */
export const POST = apiHandler(async (req) => {
  await apiContext();
  return ok(previewAlert(await readJson(req)));
});
