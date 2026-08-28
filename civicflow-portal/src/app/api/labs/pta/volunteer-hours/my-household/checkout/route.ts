import { withApiErrorHandling } from "@/lib/api-route";
import { createVolunteerBuyoutCheckout } from "@/lib/labs/pta/volunteer-hours/purchases";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  periodId: z.string().min(1),
  electionId: z.string().min(1).nullable().optional(),
  electionType: z.enum(["FULL_BUYOUT", "PARTIAL_BUYOUT"]),
  hoursElectedMinutes: z.number().int().min(1).max(100_000).optional(),
  coverProcessingCosts: z.boolean().optional(),
});

/** POST /api/labs/pta/volunteer-hours/my-household/checkout — creates a
 * Stripe Checkout Session for the caller's own household. The price is
 * always resolved fresh server-side (buildBuyoutQuote); the client only
 * ever supplies which election type and how many hours it wants a quote
 * for, never an amount. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:pta-volunteer-hours:checkout", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session, adult } = await requireVolunteerHoursHouseholdAccess("buyout");
    const input = await parseJsonBody(request, bodySchema);
    const result = await createVolunteerBuyoutCheckout(organizationId, input.periodId, adult.householdId, input, { userId: session.userId });
    return Response.json({ ok: true, url: result.url });
  });
}
