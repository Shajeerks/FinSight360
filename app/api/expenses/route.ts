import { apiHandler, ok } from "@/lib/api";
import { pageNumber } from "@/validators/common";
import { apiContext, readJson, searchParamsObject } from "@/lib/api-route";
import { currentYearMonth, parseYearMonth } from "@/lib/dates";
import { getExpenseOverview } from "@/services/income-expense.service";
import { createTransaction } from "@/services/transaction.service";

export const dynamic = "force-dynamic";

/** GET /api/expenses?month=YYYY-MM — category tree, fixed vs discretionary, payment methods. */
export const GET = apiHandler(async (req) => {
  const { user } = await apiContext();
  const sp = searchParamsObject(req);
  const ym = parseYearMonth(sp.month) ?? currentYearMonth();
  return ok(await getExpenseOverview(user.id, ym, pageNumber(sp.page)));
});

/** POST /api/expenses — shortcut for a transaction of kind EXPENSE. */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const body = (await readJson(req)) as Record<string, unknown>;
  return ok(await createTransaction(user.id, { ...body, kind: "EXPENSE" }, meta), { status: 201 });
});
