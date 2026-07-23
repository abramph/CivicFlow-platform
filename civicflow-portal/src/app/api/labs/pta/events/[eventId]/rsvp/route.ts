import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { setPtaEventRsvp } from "@/lib/labs/pta/events";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  status: z.enum(["GOING", "NOT_GOING", "MAYBE"]),
  attendeeCount: z.number().int().min(1).optional(),
});

/** RSVPs for the CALLER'S OWN household only — householdId is never accepted from the client. */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requirePtaHouseholdSelfAccess();
    const { eventId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const rsvp = await setPtaEventRsvp(organizationId, eventId, adult.householdId, input, session.userId, session.userEmail);
    return Response.json({ ok: true, data: rsvp });
  });
}
