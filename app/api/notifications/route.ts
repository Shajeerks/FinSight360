import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson, searchParamsObject } from "@/lib/api-route";
import { listNotifications, markRead, unreadCount } from "@/services/notification.service";

export const dynamic = "force-dynamic";

/** GET /api/notifications?unread=1&limit=20 — in-app notifications (newest first) + unread count. */
export const GET = apiHandler(async (req) => {
  const { user } = await apiContext();
  const q = searchParamsObject(req);
  const limit = Math.max(1, Math.min(200, Number(q.limit) || 50));
  const [items, unread] = await Promise.all([listNotifications(user.id, { unreadOnly: q.unread === "1", limit }), unreadCount(user.id)]);
  return ok({ items, unread });
});

/** POST /api/notifications — mark read: { ids: [...] } or { all: true } */
export const POST = apiHandler(async (req) => {
  const { user } = await apiContext();
  return ok(await markRead(user.id, await readJson(req)));
});
