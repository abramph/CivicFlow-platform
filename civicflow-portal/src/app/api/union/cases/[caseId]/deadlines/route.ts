import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseDeadlinesManage } from "@/lib/union/cases-guard";
import { addUnionCaseDeadline } from "@/lib/union/cases";
import { parseJsonBody, z } from "@/lib/validation";

const deadlineSchema = z.object({
  deadlineType: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  dueAt: z.string().datetime(),
  responsibleOrgMemberId: z.string().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireUnionCaseDeadlinesManage();
    const { caseId } = await params;
    const input = await parseJsonBody(request, deadlineSchema);

    const created = await addUnionCaseDeadline({
      organizationId,
      caseId,
      deadlineType: input.deadlineType,
      description: input.description,
      dueAt: new Date(input.dueAt),
      responsibleOrgMemberId: input.responsibleOrgMemberId,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: created }, { status: 201 });
  });
}
