import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { requireUnionCaseMobileMemberAccess } from "@/lib/union/cases-guard";
import { toMemberSafeUnionCase } from "@/lib/union/cases";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/union/cases/[caseId]?organizationId=...
 * Native counterpart to /api/union/cases/my/[caseId] -- case detail
 * including member-visible comments and open deadlines, scoped to a case
 * the caller's own mobile-authenticated memberId actually owns.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");
    const { caseId } = await params;

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);
    await requireUnionCaseMobileMemberAccess(verifiedOrgId, caseId, memberId);

    const unionCase = await prisma.unionCase.findFirst({
      where: { id: caseId, organizationId: verifiedOrgId },
      include: { comments: { orderBy: { createdAt: "desc" } }, deadlines: { orderBy: { dueAt: "asc" } } },
    });

    // Route-layer concern per toMemberSafeUnionCase's own doc comment --
    // resolving assignedToOrgMemberId to a display name is deliberately not
    // that function's job. Nothing about the representative beyond their
    // display name reaches the member response.
    let representativeName: string | null = null;
    if (unionCase!.assignedToOrgMemberId) {
      const assignee = await prisma.orgMember.findFirst({
        where: { id: unionCase!.assignedToOrgMemberId, organizationId: verifiedOrgId },
        select: { firstName: true, lastName: true, preferredName: true },
      });
      representativeName = assignee ? `${assignee.preferredName ?? assignee.firstName} ${assignee.lastName}` : null;
    }

    return Response.json({ ok: true, data: { ...toMemberSafeUnionCase(unionCase!), representativeName } });
  });
}
