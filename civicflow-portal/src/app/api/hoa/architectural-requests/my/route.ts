import { withApiErrorHandling } from "@/lib/api-route";
import { listMyArchitecturalRequests, requireArchitecturalRequestSubmissionEligibility } from "@/lib/hoa/architectural-requests-guard";
import { createArchitecturalRequestDraft, toResidentSafeArchitecturalRequest } from "@/lib/hoa/architectural-requests";
import { parseJsonBody, z } from "@/lib/validation";

/** Resident self-service: every request the caller has ever submitted, in
 * the active organization -- unlike violations' resident list (which
 * excludes DRAFT), a resident's own drafts ARE shown here since they're
 * the one working on them. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return Response.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }

    const requests = await listMyArchitecturalRequests(organizationId);
    return Response.json({ ok: true, data: requests.map(toResidentSafeArchitecturalRequest) });
  });
}

const createSchema = z.object({
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  category: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  projectDescription: z.string().min(1).max(5000),
  proposedStartDate: z.string().datetime().nullable().optional(),
  proposedCompletionDate: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, createSchema);
    // Verifies the caller holds an ACTIVE OWNER/CO_OWNER/NON_RESIDENT_OWNER
    // relationship to this exact property -- never trusts organizationId or
    // propertyId from the client without this check, mirroring every other
    // resident-facing HOA guard.
    const { memberId } = await requireArchitecturalRequestSubmissionEligibility(input.organizationId, input.propertyId);

    const created = await createArchitecturalRequestDraft({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      submittedByOrgMemberId: memberId,
      category: input.category,
      title: input.title,
      projectDescription: input.projectDescription,
      proposedStartDate: input.proposedStartDate ? new Date(input.proposedStartDate) : null,
      proposedCompletionDate: input.proposedCompletionDate ? new Date(input.proposedCompletionDate) : null,
    });
    return Response.json({ ok: true, data: toResidentSafeArchitecturalRequest(created) }, { status: 201 });
  });
}
