import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { getPreferences, savePreferences } from "@/services/notification.service";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await getPreferences(user.id));
});

/** PUT /api/notifications/preferences — { preferences: [{ type, channel, enabled, leadDays }] } */
export const PUT = apiHandler(async (req) => {
  const { user } = await apiContext();
  return ok(await savePreferences(user.id, await readJson(req)));
});
