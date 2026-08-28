import { withApiErrorHandling } from "@/lib/api-route";
import { listHouseholdAssessmentCharges } from "@/lib/labs/pta/volunteer-hours/assessments";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("assessments");
    const charges = await listHouseholdAssessmentCharges(organizationId, adult.householdId);
    return Response.json({ ok: true, data: charges });
  });
}
