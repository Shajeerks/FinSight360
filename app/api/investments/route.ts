import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { getPortfolio } from "@/services/investment.service";

export const dynamic = "force-dynamic";

/** GET /api/investments — portfolio: totals, XIRR, allocation, accounts with holdings, history. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await getPortfolio(user.id));
});
