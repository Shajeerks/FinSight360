import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { addInvestmentTransaction } from "@/services/investment.service";

export const dynamic = "force-dynamic";

/** POST /api/investments/transactions — BUY / SIP / SELL / REDEMPTION / DIVIDEND / BONUS / SPLIT / SWITCH_IN / SWITCH_OUT */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await addInvestmentTransaction(user.id, await readJson(req), meta), { status: 201 });
});
