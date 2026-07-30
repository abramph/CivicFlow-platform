import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { getPtaVolunteerHourTotalsForHousehold, listPtaVolunteerCommitments } from "@/lib/labs/pta/volunteers";
import { getPtaProfile } from "@/lib/labs/pta/profile";

/** The caller's OWN household only — householdId is resolved from requirePtaHouseholdSelfAccess(), never a client parameter. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requirePtaHouseholdSelfAccess();
    const profile = await getPtaProfile(organizationId);
    const schoolYear = profile?.currentSchoolYear ?? new Date().getFullYear().toString();

    const [totals, commitments] = await Promise.all([
      getPtaVolunteerHourTotalsForHousehold(organizationId, adult.householdId, schoolYear),
      listPtaVolunteerCommitments(organizationId, adult.id),
    ]);

    return Response.json({ ok: true, data: { totals, commitments, schoolYear } });
  });
}
