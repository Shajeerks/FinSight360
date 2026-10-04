import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { recordLoanPayment } from "@/services/loan.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST {paymentType: EMI|PREPAYMENT|FORECLOSURE|CHARGE, paymentDate, amount, account, recordInLedger, prepaymentMode} */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await recordLoanPayment(user.id, (await params).id, await readJson(req), meta), { status: 201 });
});
