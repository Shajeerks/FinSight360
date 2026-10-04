import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { getLoanDetail } from "@/services/loan.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/loans/:id/amortization — every instalment: opening, EMI, principal, interest, closing, scheduled vs actual. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const { user } = await apiContext();
  const d = await getLoanDetail(user.id, (await params).id);
  return ok({ loanId: d.loan.id, emiAmount: d.loan.emiAmount, interestRate: d.loan.interestRate, schedule: d.schedule.map((r) => ({
      installmentNumber: r.installmentNumber,
      dueDate: r.dueDate,
      openingPrincipal: r.openingPrincipal,
      emiAmount: r.emiAmount,
      principalComponent: r.principalComponent,
      interestComponent: r.interestComponent,
      closingPrincipal: r.closingPrincipal,
      status: r.status,
      actualPaid: r.actualPaid,
      difference: r.difference,
      overdue: r.overdue,
    })), analysis: d.analysis });
});
