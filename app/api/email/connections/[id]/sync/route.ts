import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { limiters } from "@/lib/security/rate-limit";
import { syncEmailConnection } from "@/services/email.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/email/connections/:id/sync — fetch and import new bank alerts. Optional JSON {days} for the first sync. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  const rl = await limiters.emailSync.check(`email-sync:${user.id}`);
  if (!rl.allowed) throw new AppError(`Please wait ${rl.retryAfterSeconds}s before syncing again.`, 429, "RATE_LIMITED");
  let body: unknown = {};
  if ((req.headers.get("content-type") ?? "").includes("application/json")) body = await req.json().catch(() => ({}));
  return ok(await syncEmailConnection(user.id, (await params).id, body, meta));
});
