import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { cancelImport, getImport } from "@/services/import.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/imports/:id — the import with every parsed row and its duplicate verdict. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const { user } = await apiContext();
  const d = await getImport(user.id, (await params).id);
  return ok({ import: d.imp, rows: d.rows, counts: d.counts, matched: Object.fromEntries(d.matched) });
});

/** DELETE /api/imports/:id — cancel an import that hasn't been committed. */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  await cancelImport(user.id, (await params).id, meta);
  return ok({ cancelled: true });
});
