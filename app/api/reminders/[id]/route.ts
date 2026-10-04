import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { deleteReminder, getReminder, saveReminder } from "@/services/reminder.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const { user } = await apiContext();
  return ok(await getReminder(user.id, (await params).id));
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await saveReminder(user.id, (await params).id, await readJson(req), meta));
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  await deleteReminder(user.id, (await params).id, meta);
  return ok({ deleted: true });
});
