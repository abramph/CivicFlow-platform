import { withApiErrorHandling } from "@/lib/api-route";
import { requireArchitecturalRequestResidentAccess } from "@/lib/hoa/architectural-requests-guard";
import { toResidentSafeArchitecturalRequest, updateArchitecturalRequestDraft } from "@/lib/hoa/architectural-requests";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return Response.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }
    const { requestId } = await params;

    await requireArchitecturalRequestResidentAccess(organizationId, requestId);

    const architecturalRequest = await prisma.architecturalRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { comments: { orderBy: { createdAt: "desc" } } },
    });
    // requireArchitecturalRequestResidentAccess() already confirmed this
    // row exists and belongs to the caller; re-fetching here is just to
    // pick up the comments include.
    return Response.json({ ok: true, data: toResidentSafeArchitecturalRequest(architecturalRequest!) });
  });
}

const updateSchema = z.object({
  organizationId: z.string().min(1),
  category: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
  projectDescription: z.string().min(1).max(5000).optional(),
  proposedStartDate: z.string().datetime().nullable().optional(),
  proposedCompletionDate: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { requestId } = await params;
    const input = await parseJsonBody(request, updateSchema);
    const { memberId } = await requireArchitecturalRequestResidentAccess(input.organizationId, requestId);

    const updated = await updateArchitecturalRequestDraft({
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
