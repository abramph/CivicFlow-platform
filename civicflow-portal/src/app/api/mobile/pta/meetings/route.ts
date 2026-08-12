import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { buildHouseholdRsvpBlock } from "@/lib/event-rsvp";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/meetings?organizationId=...
 * Upcoming meetings for a PTA household adult, each carrying the normalized
 * household `rsvp` block — the meeting counterpart of /api/mobile/pta/events.
 * Meetings are org-wide reads (no per-member visibility model, same as
 * events); only the caller's own household's RSVP is joined in. No legacy
 * `myRsvp` field here — this surface is new, so nothing predates the block.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const meetings = await prisma.meeting.findMany({
      where: { organizationId: verifiedOrgId, meetingDate: { gte: new Date() } },
      orderBy: [{ meetingDate: "asc" }],
      select: {
        id: true,
        title: true,
        meetingType: true,
        meetingDate: true,
        location: true,
        description: true,
        ptaMeetingRsvps: { where: { householdId: adult.householdId }, select: { status: true, attendeeCount: true } },
      },
      take: 50,
    });

    const data = meetings.map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      meetingType: meeting.meetingType,
      meetingDate: meeting.meetingDate,
      location: meeting.location,
      description: meeting.description,
      rsvp: buildHouseholdRsvpBlock(
        adult.householdId,
        meeting.ptaMeetingRsvps[0]
          ? { status: meeting.ptaMeetingRsvps[0].status, attendeeCount: meeting.ptaMeetingRsvps[0].attendeeCount }
          : null
      ),
    }));

    return Response.json({ ok: true, data });
  });
}
