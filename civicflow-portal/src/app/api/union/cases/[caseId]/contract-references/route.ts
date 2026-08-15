import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseManage } from "@/lib/union/cases-guard";
import { addUnionCaseContractReference } from "@/lib/union/cases";
import { parseJsonBody, z } from "@/lib/validation";

const contractReferenceSchema = z.object({
  reference: z.string().min(1).max(200),
  note: z.string().max(2000).nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireUnionCaseManage();
    const { caseId } = await params;
    const input = await parseJsonBody(request, contractReferenceSchema);

    const created = await addUnionCaseContractReference({
      organizationId,
      caseId,
      reference: input.reference,
      note: input.note,
    });
    return Response.json({ ok: true, data: created }, { status: 201 });
  });
}
