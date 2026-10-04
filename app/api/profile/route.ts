import { apiHandler, ok, parseOrThrow } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { getRequestMeta } from "@/lib/security/request";
import { getProfile, updateProfile } from "@/services/profile.service";
import { profileSchema } from "@/validators/profile";

export const dynamic = "force-dynamic";

/** GET /api/profile — the signed-in user's profile (never includes the password hash). */
export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  return ok(await getProfile(user.id));
});

/** PATCH /api/profile — update name, timezone, currency, alert threshold. */
export const PATCH = apiHandler(async (req) => {
  const user = await requireApiUser();
  const body = parseOrThrow(profileSchema, await req.json().catch(() => ({})));
  await updateProfile(user.id, body, await getRequestMeta());
  return ok(await getProfile(user.id));
});
