import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { reviseInterestRate } from "@/services/loan.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST {interestRate, mode: KEEP_EMI|KEEP_TENURE} — floating-rate revision. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  await reviseInterestRate(user.id, (await params).id, await readJson(req), meta);
  return ok({ revised: true });
});
