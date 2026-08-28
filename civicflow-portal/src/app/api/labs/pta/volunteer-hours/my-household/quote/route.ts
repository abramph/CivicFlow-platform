import { withApiErrorHandling } from "@/lib/api-route";
import { buildBuyoutQuote } from "@/lib/labs/pta/volunteer-hours/elections";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  periodId: z.string().min(1),
  electionType: z.enum(["VOLUNTEER", "FULL_BUYOUT", "PARTIAL_BUYOUT"]),
  hoursElectedMinutes: z.number().int().min(1).max(100_000).optional(),
});

/** POST /api/labs/pta/volunteer-hours/my-household/quote — a non-binding
 * preview. The server recomputes the price from scratch every time; the
 * client never gets to submit a price, only a requested hour count. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("buyout");
    const input = await parseJsonBody(request, bodySchema);
    const quote = await buildBuyoutQuote(organizationId, input.periodId, adult.householdId, input);
    return Response.json({ ok: true, data: quote });
  });
}
