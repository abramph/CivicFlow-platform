import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { setPtaMeetingRsvp } from "@/lib/labs/pta/meetings";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["GOING", "NOT_GOING", "MAYBE"]),
  attendeeCount: z.number().int().min(1).optional(),
});

/**
 * POST /api/mobile/pta/meetings/[id]/rsvp
 * Household meeting RSVP — mirrors the PTA event RSVP bridge exactly: the
 * household is always the caller's own (resolved via
 * requireMobilePtaHouseholdAccess, never client-supplied), upserted by
 * (meetingId, householdId) so repeat taps are idempotent updates.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, status, attendeeCount } = await parseJsonBody(request, bodySchema);
    const { organizationId: verifiedOrgId, session, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const { id: meetingId } = await params;

    const rsvp = await setPtaMeetingRsvp(verifiedOrgId, meetingId, adult.householdId, { status, attendeeCount }, session.userId, session.email);
    return Response.json({ ok: true, data: rsvp });
  });
}
