import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { getReminderItems, saveReminder } from "@/services/reminder.service";

export const dynamic = "force-dynamic";

/** GET /api/reminders — your reminders plus card dues, EMIs and recurring payments, with status. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await getReminderItems(user.id));
});

/** POST /api/reminders — { type, title, dueDate, amount?, recurrence?, leadDays?, description? } */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await saveReminder(user.id, null, await readJson(req), meta), { status: 201 });
});
