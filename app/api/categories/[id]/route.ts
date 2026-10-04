import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { deleteCategory, updateCategory } from "@/services/category.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await updateCategory(user.id, (await params).id, await readJson(req), meta));
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  await deleteCategory(user.id, (await params).id, meta);
  return ok({ deleted: true });
});
