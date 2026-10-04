import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { createHolding } from "@/services/investment.service";

export const dynamic = "force-dynamic";

/** POST /api/investments/holdings — add a holding as it stands today (units + average price or invested amount). */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await createHolding(user.id, await readJson(req), meta), { status: 201 });
});
