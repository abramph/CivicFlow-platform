import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseMemberAccess } from "@/lib/union/cases-guard";
import { toMemberSafeUnionCase, withdrawUnionCase } from "@/lib/union/cases";
import { parseJsonBody, z } from "@/lib/validation";

const withdrawSchema = z.object({ organizationId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { caseId } = await params;
    const input = await parseJsonBody(request, withdrawSchema);
    const { memberId } = await requireUnionCaseMemberAccess(input.organizationId, caseId);

    const updated = await withdrawUnionCase({ organizationId: input.organizationId, caseId, memberOrgMemberId: memberId });
    return Response.json({ ok: true, data: toMemberSafeUnionCase(updated) });
  });
}
