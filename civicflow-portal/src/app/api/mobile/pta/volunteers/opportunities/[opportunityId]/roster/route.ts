import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileStaffPermission } from "@/lib/mobile-auth";
import { getPtaVolunteerOpportunity } from "@/lib/labs/pta/volunteers";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/volunteers/opportunities/[opportunityId]/roster?organizationId=...
 * Full officer roster for one opportunity — every shift's signups with
 * attendance state, for the mobile check-in screen. Unlike the parent-facing
 * detail route, this deliberately includes other households' names — an
 * officer needs to identify who to check in.
 */
export async function GET(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobileStaffPermission(request, organizationId, PERMISSIONS.PTA_VOLUNTEERS_CHECKIN);
    const { opportunityId } = await params;

    const opportunity = await getPtaVolunteerOpportunity(verifiedOrgId, opportunityId);

    const data = {
      id: opportunity.id,
      title: opportunity.title,
      status: opportunity.status,
      slots: opportunity.slots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        startAt: slot.startAt,
        endAt: slot.endAt,
        capacity: slot.capacity,
        claimedCount: slot.claimedCount,
        signups: slot.signups
          .filter((s) => s.status !== "CANCELLED")
          .map((s) => ({
            signupId: s.id,
            name: s.householdAdult.name,
            status: s.status,
            manuallyAssigned: s.manuallyAssigned,
            checkInAt: s.attendance?.checkInAt ?? null,
            checkOutAt: s.attendance?.checkOutAt ?? null,
            attendanceStatus: s.attendance?.status ?? null,
            pendingHourEntry: s.hourEntries[0]?.status === "PENDING" ? { id: s.hourEntries[0].id, creditedMinutes: s.hourEntries[0].creditedMinutes } : null,
          })),
      })),
    };

    return Response.json({ ok: true, data });
  });
}
