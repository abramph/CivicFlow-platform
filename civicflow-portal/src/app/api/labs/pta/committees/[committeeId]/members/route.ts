import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { addPtaCommitteeMember } from "@/lib/labs/pta/committees";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ householdAdultId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:committees:manage");
    const { committeeId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const member = await addPtaCommitteeMember(organizationId, committeeId, input.householdAdultId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: member });
  });
}
