import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { scanForDuplicates } from "@/services/duplicate.service";

export const dynamic = "force-dynamic";

/** POST /api/duplicates/scan — look for duplicate pairs among recent transactions. */
export const POST = apiHandler(async () => {
  const { user, meta } = await apiContext();
  return ok(await scanForDuplicates(user.id, 120, meta));
});
