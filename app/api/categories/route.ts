import { ValidationError } from "@/lib/errors";
import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { createCategory, createSubCategory, listCategories } from "@/services/category.service";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await listCategories(user.id));
});

/** POST {name, kind, color} creates a category; POST {categoryId, name} creates a sub-category. */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const raw = await readJson(req);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError({ _form: ["Send a JSON object."] });
  const body = raw as Record<string, unknown>;
  const created = body.categoryId ? await createSubCategory(user.id, body, meta) : await createCategory(user.id, body, meta);
  return ok(created, { status: 201 });
});
