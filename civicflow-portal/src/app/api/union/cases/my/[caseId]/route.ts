import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseMemberAccess } from "@/lib/union/cases-guard";
import { toMemberSafeUnionCase } from "@/lib/union/cases";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return Response.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }
    const { caseId } = await params;

    await requireUnionCaseMemberAccess(organizationId, caseId);

    // requireUnionCaseMemberAccess() already confirmed this row exists and
    // belongs to the caller; re-fetching here is just to pick up the
    // comments/deadlines includes toMemberSafeUnionCase filters.
    const unionCase = await prisma.unionCase.findFirst({
      where: { id: caseId, organizationId },
      include: { comments: { orderBy: { createdAt: "desc" } }, deadlines: { orderBy: { dueAt: "asc" } } },
    });
    return Response.json({ ok: true, data: toMemberSafeUnionCase(unionCase!) });
  });
}
