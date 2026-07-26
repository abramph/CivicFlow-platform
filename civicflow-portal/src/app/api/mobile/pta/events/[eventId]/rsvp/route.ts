import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { setPtaEventRsvp } from "@/lib/labs/pta/events";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["GOING", "NOT_GOING", "MAYBE"]),
  attendeeCount: z.number().int().min(1).optional(),
});

/**
 * POST /api/mobile/pta/events/[eventId]/rsvp
 * Mobile bridge for the caller's own household's RSVP — identical to the
 * web's `POST /api/labs/pta/events/[eventId]/rsvp`, same underlying
 * `setPtaEventRsvp()` (household-level, upserted by (eventId, householdId),
 * so a duplicate tap is a no-op update, not a duplicate row — idempotent by
 * construction, not by any special-casing here).
 */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, status, attendeeCount } = await parseJsonBody(request, bodySchema);
    const { organizationId: verifiedOrgId, session, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const { eventId } = await params;

    const rsvp = await setPtaEventRsvp(verifiedOrgId, eventId, adult.householdId, { status, attendeeCount }, session.userId, session.email);
    return Response.json({ ok: true, data: rsvp });
  });
}
