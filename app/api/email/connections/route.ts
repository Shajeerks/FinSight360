import { apiHandler, ok } from "@/lib/api";
import { apiContext } from "@/lib/api-route";
import { emailProvidersStatus, listEmailConnections } from "@/services/email.service";

export const dynamic = "force-dynamic";

/** GET /api/email/connections — connected mailboxes (no tokens) and which providers are configured. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok({ connections: await listEmailConnections(user.id), providers: emailProvidersStatus() });
});
