import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { resolveEmailCandidate } from "@/services/email.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** POST /api/email/candidates/:id — { action: APPROVE, account: "bank:<id>"|"card:<id>" } or { action: REJECT } */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  return ok(await resolveEmailCandidate(user.id, (await params).id, await readJson(req), meta));
});
