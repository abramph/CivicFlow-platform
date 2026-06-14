import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { evaluateMemberMembershipCategory } from "@/lib/membership-rules";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("members:write", "throw");
    const { id } = await params;

    const member = await prisma.orgMember.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });

    if (!member) {
      return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    }

    const result = await evaluateMemberMembershipCategory(id);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "evaluate",
      entityType: "member_membership_category",
      entityId: id,
      metadata: {
        changed: result.changed,
        matchedCategoryId: result.matchedCategory?.id ?? null,
        reason: result.reason,
      },
    });

    return Response.json({
      ok: true,
      data: {
        changed: result.changed,
        matchedCategory: result.matchedCategory,
        reason: result.reason,
      },
    });
  });
}

