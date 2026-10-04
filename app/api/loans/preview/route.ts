import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { previewEmi } from "@/services/loan.service";

export const dynamic = "force-dynamic";

/** POST /api/loans/preview {principal, interestRate, tenureMonths, emiFrequency} — EMI calculator. */
export const POST = apiHandler(async (req) => {
  await apiContext();
  return ok(previewEmi(await readJson(req)));
});
