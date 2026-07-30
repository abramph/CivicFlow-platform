import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { setPtaVolunteerOpportunityStatus } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ status: z.enum(["DRAFT", "OPEN", "CLOSED", "CANCELLED", "COMPLETED", "ARCHIVED"]) });

export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { opportunityId } = await params;
    const { status } = await parseJsonBody(request, bodySchema);
    const opportunity = await setPtaVolunteerOpportunityStatus(organizationId, opportunityId, status, session.userId, session.userEmail);
    return Response.json({ ok: true, data: opportunity });
  });
}
