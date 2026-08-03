import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganization } from "@/lib/auth-guards";
import { requirePtaVertical } from "@/lib/labs/pta/guard";
import { listApprovedPtaMinutes } from "@/lib/labs/pta/minutes";

/** Any org member (staff or parent) can read approved minutes — gated only by the PTA vertical check + an active session, matching "approved minutes visible to parent member." Draft minutes are never returned by this route (see listApprovedPtaMinutes's doc comment). */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireOrganization("throw");
    await requirePtaVertical(organizationId);
    const minutes = await listApprovedPtaMinutes(organizationId);
    return Response.json({ ok: true, data: minutes });
  });
}
