import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getVolunteerReport } from "@/lib/labs/pta/volunteer-reports";

/** GET /api/labs/pta/volunteers/report[?schoolYear=] — the §16 volunteer
 * report. Officer-only (pta:volunteers:manage): the most-active list is a
 * coordination tool, never a public ranking. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:volunteers:manage");
    const { searchParams } = new URL(request.url);
    const schoolYearParam = searchParams.get("schoolYear");
    const report = await getVolunteerReport(organizationId, schoolYearParam !== null ? { schoolYear: schoolYearParam || null } : {});
    return Response.json({ ok: true, data: report });
  });
}
