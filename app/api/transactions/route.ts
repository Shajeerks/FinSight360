import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson, searchParamsObject } from "@/lib/api-route";
import { createTransaction, listTransactions } from "@/services/transaction.service";
import { parseTransactionFilters } from "@/validators/transactions";

export const dynamic = "force-dynamic";

/**
 * GET /api/transactions?q=&from=&to=&account=bank:<id>|card:<id>|cash:<id>&category=&subCategory=
 *   &merchant=&min=&max=&type=&direction=&source=&duplicate=&origin=manual|imported&status=&page=
 */
export const GET = apiHandler(async (req) => {
  const { user } = await apiContext();
  return ok(await listTransactions(user.id, parseTransactionFilters(searchParamsObject(req))));
});

/** POST /api/transactions — create (a transfer creates two linked legs). */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await createTransaction(user.id, await readJson(req), meta), { status: 201 });
});
