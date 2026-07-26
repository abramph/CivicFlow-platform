import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { getPtaVolunteerHourTotalsForHousehold } from "@/lib/labs/pta/volunteers";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/volunteers/hours?organizationId=...
 * Approved/pending minutes and family goal progress for the caller's own
 * household. `requiredMinutes: null` means this PTA doesn't track a
 * required amount at all — the mobile client must render that as "not
 * required", never as a 0-hour goal (see docs/pta-volunteer-management.md).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const profile = await getPtaProfile(verifiedOrgId);
    const schoolYear = profile?.currentSchoolYear ?? null;
    if (!schoolYear) {
      return Response.json({ ok: true, data: { schoolYear: null, approvedMinutes: 0, pendingMinutes: 0, requiredMinutes: null, remainingMinutes: null } });
    }

    const totals = await getPtaVolunteerHourTotalsForHousehold(verifiedOrgId, adult.householdId, schoolYear);
    return Response.json({ ok: true, data: { schoolYear, ...totals } });
  });
}
