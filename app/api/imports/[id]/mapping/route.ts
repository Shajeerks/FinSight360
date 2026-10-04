import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { applyMapping } from "@/services/import.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/imports/:id/mapping — apply a column mapping (CSV/XLSX) and run the duplicate check. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  await applyMapping(user.id, (await params).id, await readJson(req), meta);
  return ok({ status: "AWAITING_REVIEW" });
});
