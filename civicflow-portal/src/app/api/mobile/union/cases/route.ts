import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { listMyUnionCasesForMobileMember, requireUnionCaseMobileSubmitterAccess } from "@/lib/union/cases-guard";
import { createUnionCaseIntake, toMemberSafeUnionCase } from "@/lib/union/cases";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

/** Route-layer concern per toMemberSafeUnionCase's own doc comment
 * ("resolving [assignedToOrgMemberId] to a display name is a route-layer
 * concern, not this function's") -- a single batched lookup, never N+1,
 * and nothing about the representative beyond their display name reaches
 * the member response. */
async function resolveRepresentativeNames(organizationId: string, orgMemberIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(orgMemberIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const assignees = await prisma.orgMember.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, firstName: true, lastName: true, preferredName: true },
  });
  return new Map(assignees.map((a) => [a.id, `${a.preferredName ?? a.firstName} ${a.lastName}`]));
}

/**
 * GET /api/mobile/union/cases?organizationId=...
 * Native counterpart to /api/union/cases/my (which requires a NextAuth web
 * session the mobile app's bearer-token client can never hold) -- every
 * case the caller has ever submitted, in the active organization.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const cases = await listMyUnionCasesForMobileMember(verifiedOrgId, memberId);
    const names = await resolveRepresentativeNames(verifiedOrgId, cases.map((c) => c.assignedToOrgMemberId));
    const data = cases.map((c) => ({
      ...toMemberSafeUnionCase(c),
      representativeName: c.assignedToOrgMemberId ? (names.get(c.assignedToOrgMemberId) ?? null) : null,
    }));
    return Response.json({ ok: true, data });
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

/**
 * POST /api/mobile/union/cases
 * Native counterpart to POST /api/union/cases/my (the "Get Help" intake
 * form) -- creates an intake/case request, never a formal grievance on its
 * own (see createUnionCaseIntake). organizationId is re-verified against
 * the caller's own mobile-authenticated membership before any write.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, createSchema);
    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, input.organizationId);
    await requireUnionCaseMobileSubmitterAccess(verifiedOrgId, memberId);

    const created = await createUnionCaseIntake({
      organizationId: verifiedOrgId,
      memberOrgMemberId: memberId,
      caseType: input.caseType,
      title: input.title,
      description: input.description,
      incidentDate: input.incidentDate ? new Date(input.incidentDate) : null,
      representationRequested: input.representationRequested,
    });
    return Response.json({ ok: true, data: { ...toMemberSafeUnionCase(created), representativeName: null } }, { status: 201 });
  });
}
