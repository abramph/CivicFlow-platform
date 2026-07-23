import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganization } from "@/lib/auth-guards";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import { listApprovedPtaMinutes } from "@/lib/labs/pta/minutes";

/** Any enrolled-org member (staff or parent) can read approved minutes — gated only by Labs enrollment + an active session, matching "approved minutes visible to parent member." Draft minutes are never returned by this route (see listApprovedPtaMinutes's doc comment). */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireOrganization();
    await requireOrganizationLabFeature(organizationId, "ptaVertical");
    const minutes = await listApprovedPtaMinutes(organizationId);
    return Response.json({ ok: true, data: minutes });
  });
}
