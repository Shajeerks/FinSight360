import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { updateHoldingPrice } from "@/services/investment.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/investments/holdings/:id/price — { currentPrice } */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await updateHoldingPrice(user.id, (await params).id, await readJson(req), meta));
});
