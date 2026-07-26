import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { listPendingPtaVolunteerHourEntries } from "@/lib/labs/pta/volunteers";

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:volunteer-hours:approve");
    const url = new URL(request.url);
    const entries = await listPendingPtaVolunteerHourEntries(organizationId, {
      schoolYear: url.searchParams.get("schoolYear") ?? undefined,
      opportunityId: url.searchParams.get("opportunityId") ?? undefined,
    });
    return Response.json({ ok: true, data: entries });
  });
}
