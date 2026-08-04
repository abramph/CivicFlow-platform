import { withApiErrorHandling } from "@/lib/api-route";
import { requireArchitecturalRequestResidentAccess } from "@/lib/hoa/architectural-requests-guard";
import { submitArchitecturalRequest, toResidentSafeArchitecturalRequest } from "@/lib/hoa/architectural-requests";
import { parseJsonBody, z } from "@/lib/validation";

const submitSchema = z.object({ organizationId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { requestId } = await params;
    const input = await parseJsonBody(request, submitSchema);
    const { memberId } = await requireArchitecturalRequestResidentAccess(input.organizationId, requestId);

    const updated = await submitArchitecturalRequest({
      organizationId: input.organizationId,
      requestId,
      submittedByOrgMemberId: memberId,
    });
    return Response.json({ ok: true, data: toResidentSafeArchitecturalRequest(updated) });
  });
}
