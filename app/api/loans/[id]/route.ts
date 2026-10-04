import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { deleteLoan, getLoanDetail, updateLoanDetails } from "@/services/loan.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const { user } = await apiContext();
  return ok(await getLoanDetail(user.id, (await params).id));
});

/** PATCH — name, lender, last 4, interest type, repayment account, notes. */
export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await updateLoanDetails(user.id, (await params).id, await readJson(req), meta));
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  await deleteLoan(user.id, (await params).id, meta);
  return ok({ deleted: true });
});
