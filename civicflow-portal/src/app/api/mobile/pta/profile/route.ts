import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { ValidationError } from "@/lib/validation";
import { PtaError } from "@/lib/labs/pta/errors";

/**
 * GET /api/mobile/pta/profile?organizationId=...
 * The organization's PTA display name and current school year — the mobile
 * client needs `currentSchoolYear` up front since every other PTA endpoint
 * (hours, requirement) is scoped by it.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const profile = await getPtaProfile(verifiedOrgId);
    if (!profile) throw new PtaError("PTA_PROFILE_NOT_FOUND", "PTA profile has not been configured for this organization.");

    return Response.json({
      ok: true,
      data: { schoolOrPtaName: profile.schoolOrPtaName, designation: profile.designation, currentSchoolYear: profile.currentSchoolYear },
    });
  });
}
