import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { commitImport } from "@/services/import.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/imports/:id/commit — write the reviewed rows to the ledger. */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await commitImport(user.id, (await params).id, meta));
});
