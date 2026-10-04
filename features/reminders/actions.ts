"use server";

import { revalidatePath } from "next/cache";
import { requireApiUser } from "@/lib/auth/session";
import { assertIds, runAction } from "@/lib/api";
import { AppError, type ActionResult } from "@/lib/errors";
import { getRequestMeta } from "@/lib/security/request";
import { completeReminder, deleteReminder, saveReminder } from "@/services/reminder.service";
import { deleteNotification, generateIfStale, markRead, savePreferences } from "@/services/notification.service";

function refresh() {
  for (const p of ["/reminders", "/notifications", "/dashboard"]) revalidatePath(p);
}

export async function saveReminderAction(id: string | null, input: unknown): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(async () => {
    await saveReminder(user.id, id, input, meta);
    // A reminder that's already due should alert right away, not at the next scheduled run.
    await generateIfStale(user.id, 0);
  }, id ? "Reminder updated." : "Reminder added.");
  if (res.ok) refresh();
  return res;
}

export async function completeReminderAction(key: string): Promise<ActionResult<{ next: string | null }>> {
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(async () => {
    if (typeof key !== "string" || key.length > 120) throw new AppError("Invalid reminder.", 400, "INVALID_INPUT");
    const r = await completeReminder(user.id, key, meta);
    return { next: r.next ? r.next.toISOString().slice(0, 10) : null };
  });
  if (res.ok) refresh();
  return res;
}

export async function deleteReminderAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const meta = await getRequestMeta();
  const res = await runAction(() => deleteReminder(user.id, id, meta), "Reminder deleted.");
  if (res.ok) refresh();
  return res;
}

export async function markNotificationsReadAction(input: { ids?: string[]; all?: boolean }): Promise<ActionResult> {
  const user = await requireApiUser();
  const res = await runAction(async () => void (await markRead(user.id, input)));
  if (res.ok) refresh();
  return res;
}

export async function deleteNotificationAction(id: string): Promise<ActionResult> {
  assertIds(id);
  const user = await requireApiUser();
  const res = await runAction(() => deleteNotification(user.id, id));
  if (res.ok) refresh();
  return res;
}

export async function savePreferencesAction(input: unknown): Promise<ActionResult> {
  const user = await requireApiUser();
  const res = await runAction(async () => void (await savePreferences(user.id, input)), "Notification settings saved.");
  if (res.ok) revalidatePath("/notifications");
  return res;
}
