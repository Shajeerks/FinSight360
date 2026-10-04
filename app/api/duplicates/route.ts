import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { listDuplicateCandidates } from "@/services/duplicate.service";

export const dynamic = "force-dynamic";

/** GET /api/duplicates — pending possible-duplicate pairs, highest score first. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await listDuplicateCandidates(user.id));
});
