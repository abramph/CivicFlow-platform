import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";
import { getAdminMeetingRsvpView } from "@/lib/meeting-rsvp";

/**
 * GET /api/mobile/admin/meetings/[meetingId]?organizationId=...
 *
 * Read-only meeting RSVP planning for an authorized administrator — the
 * meeting counterpart of the admin event detail's rsvp block, deliberately
 * NOT a meeting-administration API: no PATCH/DELETE, no agenda/minutes
 * surface area (meetings administration stays web-first). Gated on the
 * manageMeetings capability (meetings:write) exactly as events are gated on
 * manageEvents; the tenancy 404 runs before any RSVP aggregation, and
 * getAdminMeetingRsvpView's underlying list services re-verify meeting
 * tenancy themselves (defense in depth).
 */
export async function GET(request: Request, { params }: { params: Promise<{ meetingId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await requireMobileAdminAccess(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageMeetings")) {
      throw new MobileForbiddenError("No mobile meeting administration access for this organization");
    }

    const { meetingId } = await params;
    const meeting = await prisma.meeting.findFirst({
      where: { id: meetingId, organizationId },
      select: { id: true, title: true, meetingDate: true, location: true, status: true },
    });
    if (!meeting) {
      return Response.json({ ok: false, error: "Meeting not found" }, { status: 404 });
    }

    const rsvp = await getAdminMeetingRsvpView(organizationId, meetingId);
    return Response.json({ ok: true, data: { ...meeting, rsvp } });
  });
}
