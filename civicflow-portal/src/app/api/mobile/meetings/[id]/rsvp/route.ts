import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { buildIndividualRsvpBlock } from "@/lib/event-rsvp";
import { setMeetingRsvp } from "@/lib/meeting-rsvp";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["GOING", "NOT_GOING", "MAYBE"]),
});

/**
 * POST /api/mobile/meetings/[id]/rsvp
 * Individual (per-OrgMember) meeting RSVP for Community/Union — the exact
 * meeting counterpart of POST /api/mobile/events/[eventId]/rsvp, with the
 * same identity rules: subject is always the caller's own server-resolved
 * OrgMember (no orgMemberId accepted from the client), any role with a
 * linked member may RSVP, staff-only fails the guard's 403, and
 * setMeetingRsvp() rejects PTA (household is authoritative) and HOA (mode
 * none) verticals.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, status } = await parseJsonBody(request, bodySchema);
    const { organizationId: verifiedOrgId, session, memberId } = await requireMobileMembership(request, organizationId);
    const { id: meetingId } = await params;

    const rsvp = await setMeetingRsvp(verifiedOrgId, meetingId, memberId, { status }, session.userId, session.email);
    return Response.json({ ok: true, data: buildIndividualRsvpBlock(memberId, { status: rsvp.status }) });
  });
}
