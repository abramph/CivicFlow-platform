import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileStaffPermission } from "@/lib/mobile-auth";
import { listPendingPtaVolunteerHourEntries } from "@/lib/labs/pta/volunteers";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/volunteers/hour-entries/pending?organizationId=...
 * The mobile hour-approval queue. Gated by PTA_VOLUNTEER_HOURS_APPROVE, a
 * separate permission from PTA_VOLUNTEERS_CHECKIN — a Volunteer Coordinator
 * who can check people in is not automatically granted hour-approval
 * authority (matches the web's authorization model exactly).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobileStaffPermission(request, organizationId, PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE);

    const entries = await listPendingPtaVolunteerHourEntries(verifiedOrgId);
    const data = entries.map((e) => ({
      id: e.id,
      creditedMinutes: e.creditedMinutes,
      source: e.source,
      submittedAt: e.createdAt,
      volunteerName: e.signup.householdAdult.name,
      opportunityTitle: e.signup.slot.opportunity.title,
    }));

    return Response.json({ ok: true, data });
  });
}
