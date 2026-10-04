import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { createLoan, getLoansOverview } from "@/services/loan.service";

export const dynamic = "force-dynamic";

/** GET /api/loans — loans with progress, next EMI and interest analysis. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await getLoansOverview(user.id));
});

/** POST /api/loans — creates the loan and its full amortization schedule. */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await createLoan(user.id, await readJson(req), meta), { status: 201 });
});
