import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { listApprovedPtaMinutes } from "@/lib/labs/pta/minutes";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/minutes?organizationId=...
 * Approved minutes only — mirrors the web's `GET /api/labs/pta/minutes`
 * exactly (listApprovedPtaMinutes(), unmodified). Draft/in-review minutes
 * are never returned — see meeting-minutes.ts's getApprovedMeetingMinutes.
 *
 * Note: there is no mobile "list upcoming meetings / agenda" route — the
 * web's own meeting list is gated by the staff-only `meetings:read`
 * permission, so there is no existing parent-facing precedent to bridge.
 * Building one would be a new product/authorization decision (should
 * parents see meeting agendas and officer notes?), not a bridge onto
 * existing behavior — deliberately left out of this pass.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const minutes = await listApprovedPtaMinutes(verifiedOrgId);
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
