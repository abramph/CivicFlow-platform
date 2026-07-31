import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileOrgAccess } from "@/lib/mobile-auth";
import { getApprovedMeetingMinutes } from "@/lib/meeting-minutes";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/minutes?organizationId=... — approved-only meeting
 * minutes for ANY identity (conventional member or PTA household), unlike
 * the PTA-specific /api/mobile/pta/minutes route. Meeting minutes are an
 * org-wide governance document, not member-scoped data, so
 * requireMobileOrgAccess (the loosest mobile guard -- any active tie to the
 * org) is the correct gate here, mirroring how /api/mobile/messages already
 * treats inbox access as identity-agnostic.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileOrgAccess(request, organizationId);

    const minutes = await getApprovedMeetingMinutes(organizationId);
    const data = minutes.map((m) => ({
      id: m.id,
      title: m.title,
      meetingTitle: m.meeting.title,
      meetingDate: m.meeting.meetingDate,
      approvedAt: m.approvedAt,
    }));

    return Response.json({ ok: true, data });
  });
}
