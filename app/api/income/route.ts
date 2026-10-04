import { apiHandler, ok } from "@/lib/api";
import { pageNumber } from "@/validators/common";
import { apiContext, readJson, searchParamsObject } from "@/lib/api-route";
import { currentYearMonth, parseYearMonth } from "@/lib/dates";
import { getIncomeOverview } from "@/services/income-expense.service";
import { createTransaction } from "@/services/transaction.service";

export const dynamic = "force-dynamic";

/** GET /api/income?month=YYYY-MM — totals by category/source and the month's income. */
export const GET = apiHandler(async (req) => {
  const { user } = await apiContext();
  const sp = searchParamsObject(req);
  const ym = parseYearMonth(sp.month) ?? currentYearMonth();
  return ok(await getIncomeOverview(user.id, ym, pageNumber(sp.page)));
});

/** POST /api/income — shortcut for a transaction of kind INCOME. */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const body = (await readJson(req)) as Record<string, unknown>;
  return ok(await createTransaction(user.id, { ...body, kind: "INCOME" }, meta), { status: 201 });
});
