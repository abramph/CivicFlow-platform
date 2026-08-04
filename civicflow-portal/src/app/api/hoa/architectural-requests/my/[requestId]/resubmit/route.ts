import { withApiErrorHandling } from "@/lib/api-route";
import { requireArchitecturalRequestResidentAccess } from "@/lib/hoa/architectural-requests-guard";
import { resubmitArchitecturalRequest, toResidentSafeArchitecturalRequest } from "@/lib/hoa/architectural-requests";
import { parseJsonBody, z } from "@/lib/validation";

const resubmitSchema = z.object({
  organizationId: z.string().min(1),
  category: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
  projectDescription: z.string().min(1).max(5000).optional(),
  proposedStartDate: z.string().datetime().nullable().optional(),
  proposedCompletionDate: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { requestId } = await params;
    const input = await parseJsonBody(request, resubmitSchema);
    const { memberId } = await requireArchitecturalRequestResidentAccess(input.organizationId, requestId);

    const updated = await resubmitArchitecturalRequest({
      organizationId: input.organizationId,
      requestId,
      submittedByOrgMemberId: memberId,
      category: input.category,
      title: input.title,
      projectDescription: input.projectDescription,
      proposedStartDate: input.proposedStartDate === undefined ? undefined : input.proposedStartDate ? new Date(input.proposedStartDate) : null,
      proposedCompletionDate:
        input.proposedCompletionDate === undefined ? undefined : input.proposedCompletionDate ? new Date(input.proposedCompletionDate) : null,
    });
    return Response.json({ ok: true, data: toResidentSafeArchitecturalRequest(updated) });
  });
}
