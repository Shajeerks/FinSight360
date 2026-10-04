import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { createInvestmentAccount } from "@/services/investment.service";

export const dynamic = "force-dynamic";

/** POST /api/investments/accounts — { name, providerType, accountType, providerName?, notes? } */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await createInvestmentAccount(user.id, await readJson(req), meta), { status: 201 });
});
