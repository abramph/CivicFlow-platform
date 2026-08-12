import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { buildIndividualRsvpBlock, setEventRsvp } from "@/lib/event-rsvp";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["GOING", "NOT_GOING", "MAYBE"]),
});

/**
 * POST /api/mobile/events/[eventId]/rsvp
 * Individual (per-OrgMember) RSVP for Community/Union events — the generic
 * counterpart of the PTA household route at
 * /api/mobile/pta/events/[eventId]/rsvp, which remains household-based and
 * untouched.
 *
 * The RSVP subject is always the caller's own server-resolved OrgMember
 * (requireMobileMembership) — no orgMemberId is ever accepted from the
 * client, so a forged member ID cannot redirect RSVP ownership. Role is
 * irrelevant by design (PR #89's dual-identity architecture): an
 * ORG_OWNER/ORG_ADMIN/STAFF login with a linked OrgMember RSVPs as that
 * member; a staff-only login with no OrgMember fails the guard's own "No
 * linked member record" 403. setEventRsvp() then enforces that the org's
 * RSVP mode is actually "individual" — a PTA caller who happens to hold a
 * linked OrgMember is rejected there (household RSVP is authoritative for
 * PTA), as is any HOA caller (mode "none" this phase).
 */
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, status } = await parseJsonBody(request, bodySchema);
    const { organizationId: verifiedOrgId, session, memberId } = await requireMobileMembership(request, organizationId);
    const { eventId } = await params;

    const rsvp = await setEventRsvp(verifiedOrgId, eventId, memberId, { status }, session.userId, session.email);
    return Response.json({ ok: true, data: buildIndividualRsvpBlock(memberId, { status: rsvp.status }) });
  });
}
