import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { completeReminder } from "@/services/reminder.service";

export const dynamic = "force-dynamic";

/** POST /api/reminders/complete — { key: "r:<reminderId>" | "rec:<recurringId>:<date>" } */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const { key } = (await readJson(req)) as { key?: unknown };
  if (typeof key !== "string" || key.length > 120) throw new AppError("Invalid reminder.", 400, "INVALID_INPUT");
  return ok(await completeReminder(user.id, key, meta));
});
