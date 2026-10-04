import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { deleteHolding, getHoldingDetail, updateHolding } from "@/services/investment.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const { user } = await apiContext();
  return ok(await getHoldingDetail(user.id, (await params).id));
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await updateHolding(user.id, (await params).id, await readJson(req), meta));
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  await deleteHolding(user.id, (await params).id, meta);
  return ok({ deleted: true });
});
