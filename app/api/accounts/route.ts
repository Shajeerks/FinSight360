import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { createBankAccount, listBankAccounts } from "@/services/account.service";

export const dynamic = "force-dynamic";

/** GET /api/accounts — the user's bank accounts. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await listBankAccounts(user.id));
});

/** POST /api/accounts — add a bank account (last 4 digits only). */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await createBankAccount(user.id, await readJson(req), meta), { status: 201 });
});
