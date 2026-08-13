import { withApiErrorHandling } from "@/lib/api-route";
import { requireCommitteeManageOrChair } from "@/lib/labs/pta/guard";
import { addPtaCommitteeMember } from "@/lib/labs/pta/committees";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ householdAdultId: z.string().min(1) });

/** PTA-B: gated by requireCommitteeManageOrChair — an officer with
 * pta:committees:manage OR this committee's own chair/co-chair (scoped
 * linkage, no staff role required) can manage its member list. */
export async function POST(request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { committeeId } = await params;
    const { organizationId, session } = await requireCommitteeManageOrChair(committeeId);
    const input = await parseJsonBody(request, bodySchema);
    const member = await addPtaCommitteeMember(organizationId, committeeId, input.householdAdultId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: member });
  });
}
