import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z, ValidationError } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { createMemberTimelineEvent } from "@/lib/member-timeline";

const voidSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission(
      "contributions:write",
      "throw"
    );
    const { id } = await params;
    const input = await parseJsonBody(req, voidSchema);

    const contribution = await prisma.contribution.findFirst({
      where: { id, organizationId },
    });
    if (!contribution) {
      return Response.json({ error: "Contribution not found" }, { status: 404 });
    }
    if (contribution.voidedAt) {
      throw new ValidationError("Contribution is already voided.");
    }
    if (contribution.lockedAt) {
      throw new ValidationError(
        "This contribution is locked and cannot be voided. Contact a platform admin."
      );
    }

    const voided = await prisma.contribution.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedByUserId: session.userId,
        voidReason: input.reason?.trim() || null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "void",
      entityType: "contribution",
      entityId: id,
      metadata: {
        reason: input.reason ?? null,
        amount: contribution.amount.toString(),
        memberId: contribution.memberId,
      },
    });

    if (contribution.memberId) {
      await createMemberTimelineEvent({
        organizationId,
        memberId: contribution.memberId,
        eventType: "CONTRIBUTION_RECORDED",
        title: "Contribution voided",
        newValue: {
          contributionId: id,
          amount: contribution.amount.toString(),
          reason: input.reason ?? null,
        },
        occurredAt: new Date(),
        createdByUserId: session.userId,
      });
    }

    return Response.json({ ok: true, data: voided });
  });
}
