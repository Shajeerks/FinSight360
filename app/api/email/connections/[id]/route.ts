import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { disconnectEmail } from "@/services/email.service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/email/connections/:id?deleteData=1 — revoke access; optionally delete fetched-email records (ledger rows stay). */
export const DELETE = apiHandler<Ctx>(async (req, { params }) => {
  const { user, meta } = await apiContext();
  const deleteData = new URL(req.url).searchParams.get("deleteData") === "1";
  await disconnectEmail(user.id, (await params).id, { deleteData }, meta);
  return ok({ disconnected: true });
});
