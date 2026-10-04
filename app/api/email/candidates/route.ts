import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { listEmailCandidates } from "@/services/email.service";

export const dynamic = "force-dynamic";

/** GET /api/email/candidates — parsed alerts waiting for an account. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await listEmailCandidates(user.id));
});
