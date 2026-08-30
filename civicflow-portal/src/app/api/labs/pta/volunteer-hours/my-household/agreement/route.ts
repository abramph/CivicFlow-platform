import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getCurrentActivePeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { resolveHouseholdAgreementStatus } from "@/lib/labs/pta/volunteer-hours/agreements";

/** GET — a family's own agreement status for the current (or specified)
 * period: whether required, the assigned version's full text (so the
 * family can read it before accepting), whether/when they accepted, and
 * their contract-linked offer window if applicable. Never accepts a
 * client-supplied householdId — resolved server-side from the
 * authenticated adult's own household, same pattern as every other
 * my-household route in this program. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("requirements");
    const url = new URL(request.url);
    let periodId = url.searchParams.get("periodId");
    if (!periodId) {
      const current = await getCurrentActivePeriod(organizationId);
      if (!current) return Response.json({ ok: true, data: null });
      periodId = current.id;
    }
    const status = await resolveHouseholdAgreementStatus(organizationId, periodId, adult.householdId);
    return Response.json({ ok: true, data: { ...status, periodId } });
  });
}
