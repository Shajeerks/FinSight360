import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { listReviewQueue, resolveReview } from "@/services/duplicate.service";

export const dynamic = "force-dynamic";

/** GET /api/review — transactions waiting for approval (not yet counted). */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await listReviewQueue(user.id));
});

/** POST /api/review — { action: APPROVE | REJECT, ids: [...] } */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await resolveReview(user.id, await readJson(req), meta));
});
