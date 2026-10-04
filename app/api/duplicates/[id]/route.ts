import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { resolveDuplicate } from "@/services/duplicate.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/duplicates/:id — { action: CONFIRM_DUPLICATE | KEEP_BOTH | MERGE | IGNORE } */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await resolveDuplicate(user.id, (await params).id, await readJson(req), meta));
});
