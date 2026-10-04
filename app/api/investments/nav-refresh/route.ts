import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { refreshMutualFundNavs } from "@/services/investment.service";

export const dynamic = "force-dynamic";

/** POST /api/investments/nav-refresh — latest mutual-fund NAVs from AMFI (public data). */
export const POST = apiHandler(async () => {
  const { user, meta } = await apiContext();
  return ok(await refreshMutualFundNavs(user.id, meta));
});
