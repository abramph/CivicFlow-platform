import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileStaffPermission } from "@/lib/mobile-auth";
import { listPtaVolunteerOpportunities, listPtaUnderstaffedSlots, listPendingPtaVolunteerHourEntries } from "@/lib/labs/pta/volunteers";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/volunteers/today?organizationId=...
 * The Volunteer Coordinator's event-day staffing view: every OPEN
 * opportunity with its shift fill counts, understaffed shifts flagged, and
 * the pending-hour-approval count. Intentionally a summary, not a full
 * roster — tap into a specific opportunity for the roster/check-in screen.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobileStaffPermission(request, organizationId, PERMISSIONS.PTA_VOLUNTEERS_CHECKIN);

    const [opportunities, understaffed, pendingHourEntries] = await Promise.all([
      listPtaVolunteerOpportunities(verifiedOrgId, { status: "OPEN" }),
      listPtaUnderstaffedSlots(verifiedOrgId),
      listPendingPtaVolunteerHourEntries(verifiedOrgId),
    ]);

    const data = {
      opportunities: opportunities.map((opp) => ({
        id: opp.id,
        title: opp.title,
        slotCount: opp.slots.length,
        claimedCount: opp.slots.reduce((sum, s) => sum + s.claimedCount, 0),
        capacity: opp.slots.reduce((sum, s) => sum + s.capacity, 0),
      })),
      understaffedShiftCount: understaffed.length,
      pendingHourApprovalCount: pendingHourEntries.length,
    };

    return Response.json({ ok: true, data });
  });
}
