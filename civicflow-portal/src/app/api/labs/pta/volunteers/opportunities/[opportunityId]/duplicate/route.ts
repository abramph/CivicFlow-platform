import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { duplicatePtaVolunteerOpportunity } from "@/lib/labs/pta/volunteers";

export async function POST(_request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { opportunityId } = await params;
    const clone = await duplicatePtaVolunteerOpportunity(organizationId, opportunityId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: clone });
  });
}
