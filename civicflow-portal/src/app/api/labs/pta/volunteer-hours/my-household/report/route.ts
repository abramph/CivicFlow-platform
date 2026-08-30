import { withApiErrorHandling } from "@/lib/api-route";
import { PtaError } from "@/lib/labs/pta/errors";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getCurrentActivePeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { buildFamilySummaryReportData } from "@/lib/labs/pta/volunteer-hours/reports/family-summary";

/**
 * GET /api/labs/pta/volunteer-hours/my-household/report — a family's own
 * downloadable volunteer-hour summary (own household only, resolved from
 * requireVolunteerHoursHouseholdAccess — never a client-supplied
 * householdId, same pattern as every other my-household route). Strips
 * noteOrExceptionIndicator: an officer's internal reasoning text for a
 * non-standard assignment (e.g. why a reduction/waiver was granted), never
 * meant for the family to read verbatim. Every hours/financial figure here
 * mirrors what /my-household/summary and /my-household/assessments already
 * show the family live, so none of that is stripped.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("reports");
    const url = new URL(request.url);
    let periodId = url.searchParams.get("periodId");
    if (!periodId) {
      const current = await getCurrentActivePeriod(organizationId);
      if (!current) return Response.json({ ok: true, data: null });
      periodId = current.id;
    }

    // includeFinancials=true: this route is already scoped to the caller's
    // own household only (adult.householdId, never client-supplied) — a
    // family seeing its own buyout/assessment dollar figures is the
    // legitimate self-service case fix/pta-volunteer-financial-controls
    // explicitly preserves, distinct from the admin Report A leak it closes.
    const data = await buildFamilySummaryReportData(
      organizationId,
      { requirementPeriodId: periodId, householdId: adult.householdId },
      adult.name,
      true
    ).catch(
      (error) => {
        if (error instanceof PtaError && error.code === "PTA_VOLUNTEER_PERIOD_NOT_FOUND") return null;
        throw error;
      }
    );
    if (!data) return Response.json({ ok: true, data: null });

    const rows = data.rows.map(({ noteOrExceptionIndicator, ...rest }) => {
      void noteOrExceptionIndicator;
      return rest;
    });
    return Response.json({ ok: true, data: { ...data, rows } });
  });
}
