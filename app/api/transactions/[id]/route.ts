import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { deleteTransaction, getTransaction, updateTransaction } from "@/services/transaction.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** GET — includes the full source history. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const { user } = await apiContext();
  return ok(await getTransaction(user.id, (await params).id));
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await updateTransaction(user.id, (await params).id, await readJson(req), meta));
});

/** DELETE — soft delete; balances are recomputed. */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  await deleteTransaction(user.id, (await params).id, meta);
  return ok({ deleted: true });
});
