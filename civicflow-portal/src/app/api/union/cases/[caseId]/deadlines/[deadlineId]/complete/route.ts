import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseDeadlinesManage } from "@/lib/union/cases-guard";
import { completeUnionCaseDeadline } from "@/lib/union/cases";

export async function POST(_request: Request, { params }: { params: Promise<{ caseId: string; deadlineId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireUnionCaseDeadlinesManage();
    const { deadlineId } = await params;

    const updated = await completeUnionCaseDeadline({ organizationId, deadlineId, actorUserId: session.userId });
    return Response.json({ ok: true, data: updated });
  });
}
