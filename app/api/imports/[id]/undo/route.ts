import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { undoImport } from "@/services/import.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/imports/:id/undo — reverse a completed import. */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await undoImport(user.id, (await params).id, meta));
});
