import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { updateImportRow } from "@/services/import.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; rowId: string }> };

/** PATCH /api/imports/:id/rows/:rowId — include/exclude a row, change its type or category before import. */
export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const { user } = await apiContext();
  const p = await params;
  await updateImportRow(user.id, p.id, p.rowId, await readJson(req));
  return ok({ updated: true });
});
