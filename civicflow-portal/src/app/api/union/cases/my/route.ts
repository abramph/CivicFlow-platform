import { withApiErrorHandling } from "@/lib/api-route";
import { listMyUnionCases, requireUnionCaseSubmitterAccess } from "@/lib/union/cases-guard";
import { createUnionCaseIntake, toMemberSafeUnionCase } from "@/lib/union/cases";
import { parseJsonBody, z } from "@/lib/validation";

/** Member self-service: every case the caller has ever submitted, in the
 * active organization. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return Response.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }

    const cases = await listMyUnionCases(organizationId);
    return Response.json({ ok: true, data: cases.map(toMemberSafeUnionCase) });
  });
}

const createSchema = z.object({
  organizationId: z.string().min(1),
  caseType: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  incidentDate: z.string().datetime().nullable().optional(),
  representationRequested: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, createSchema);
    // Verifies the caller holds a real MEMBER web session AND an active
    // OrgMember record in this organization -- never trusts organizationId
    // from the client without this check. Unlike architectural requests,
    // there is no relationship-type eligibility gate: any active member may
    // submit their own case.
    const { memberId } = await requireUnionCaseSubmitterAccess(input.organizationId);

    const created = await createUnionCaseIntake({
      organizationId: input.organizationId,
      memberOrgMemberId: memberId,
      caseType: input.caseType,
      title: input.title,
      description: input.description,
      incidentDate: input.incidentDate ? new Date(input.incidentDate) : null,
      representationRequested: input.representationRequested,
    });
    return Response.json({ ok: true, data: toMemberSafeUnionCase(created) }, { status: 201 });
  });
}
