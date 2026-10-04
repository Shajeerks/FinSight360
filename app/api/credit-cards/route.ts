import { apiHandler, ok } from "@/lib/api";
import { apiContext, readJson } from "@/lib/api-route";
import { createCreditCard, getCreditCardOverview } from "@/services/credit-card.service";

export const dynamic = "force-dynamic";

/** GET /api/credit-cards — cards with utilization, available limit and due status. */
export const GET = apiHandler(async () => {
  const { user } = await apiContext();
  return ok(await getCreditCardOverview(user.id));
});

/** POST /api/credit-cards — never send CVV, PIN, OTP or the full card number. */
export const POST = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  return ok(await createCreditCard(user.id, await readJson(req), meta), { status: 201 });
});
