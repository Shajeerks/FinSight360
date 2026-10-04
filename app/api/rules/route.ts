import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { createRule, listRules } from "@/services/rule.service";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await listRules(user.id));
});

export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await createRule(user.id, await readJson(req), meta), { status: 201 });
});
