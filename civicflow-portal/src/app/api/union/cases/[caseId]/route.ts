import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseRead } from "@/lib/union/cases-guard";
import { getUnionCaseDetail } from "@/lib/union/cases";

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireUnionCaseRead();
    const { caseId } = await params;
    const unionCase = await getUnionCaseDetail(organizationId, caseId);
    return Response.json({ ok: true, data: unionCase });
  });
}
