import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { deleteNotification } from "@/services/notification.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user } = await apiContext();
  await deleteNotification(user.id, (await params).id);
  return ok({ deleted: true });
});
