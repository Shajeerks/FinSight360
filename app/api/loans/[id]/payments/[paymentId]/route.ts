import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { deleteLoanPayment } from "@/services/loan.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; paymentId: string }> };

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const { user, meta } = await apiContext();
  const p = await params;
  await deleteLoanPayment(user.id, p.id, p.paymentId, meta);
  return ok({ deleted: true });
});
