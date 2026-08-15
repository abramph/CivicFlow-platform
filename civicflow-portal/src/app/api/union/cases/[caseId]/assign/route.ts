import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseManage } from "@/lib/union/cases-guard";
import { assignUnionCase } from "@/lib/union/cases";
import { parseJsonBody, z } from "@/lib/validation";

const assignSchema = z.object({ assignedToOrgMemberId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireUnionCaseManage();
    const { caseId } = await params;
    const input = await parseJsonBody(request, assignSchema);

    const updated = await assignUnionCase({
      organizationId,
      caseId,
      assignedToOrgMemberId: input.assignedToOrgMemberId,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: updated });
  });
}
