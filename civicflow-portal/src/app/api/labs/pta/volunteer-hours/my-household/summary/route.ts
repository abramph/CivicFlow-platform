import { withApiErrorHandling } from "@/lib/api-route";
import { PtaError } from "@/lib/labs/pta/errors";
import { getFamilyVolunteerSummary } from "@/lib/labs/pta/volunteer-hours/elections";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getCurrentActivePeriod } from "@/lib/labs/pta/volunteer-hours/periods";

/** GET /api/labs/pta/volunteer-hours/my-household/summary?periodId=... —
 * the caller's OWN household only, resolved from
 * requireVolunteerHoursHouseholdAccess() — never a client-supplied
 * householdId (same pattern as my-household/volunteer-hours). periodId
 * defaults to whichever period is currently ACTIVE for the org. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("requirements");
    const url = new URL(request.url);
    let periodId = url.searchParams.get("periodId");
    if (!periodId) {
      const current = await getCurrentActivePeriod(organizationId);
      if (!current) {
        return Response.json({ ok: true, data: null });
      }
      periodId = current.id;
    }
    const summary = await getFamilyVolunteerSummary(organizationId, periodId, adult.householdId).catch((error) => {
      if (error instanceof PtaError && error.code === "PTA_VOLUNTEER_PERIOD_NOT_FOUND") return null;
      throw error;
    });
    return Response.json({ ok: true, data: summary });
  });
}
