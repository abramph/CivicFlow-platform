import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const createAdjustmentSchema = z.object({
  memberId: z.string().min(1),
  duesChargeId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  adjustmentType: z.enum(["WAIVER", "DISCOUNT", "CREDIT", "WRITE_OFF", "MANUAL_ADJUSTMENT"]),
  amount: z.number().positive(),
  reason: z.string().trim().min(3).max(1000),
  approvedByUserId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:dues:adjustments",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, createAdjustmentSchema);

    const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
    if (!member) return Response.json({ ok: false, error: "Member not found in organization." }, { status: 404 });

    const duesChargeId = input.duesChargeId || null;
    const charge = duesChargeId
      ? await prisma.duesCharge.findFirst({ where: { id: duesChargeId, organizationId, memberId: member.id }, include: { adjustments: true } })
      : null;
    if (duesChargeId && !charge) {
      return Response.json({ ok: false, error: "Dues charge not found for this member." }, { status: 404 });
    }

    const adjustment = await prisma.$transaction(async (tx) => {
      const row = await tx.duesAdjustment.create({
        data: {
          organizationId,
          memberId: member.id,
          duesChargeId,
          adjustmentType: input.adjustmentType,
          amount: input.amount,
          reason: input.reason.trim(),
          approvedByUserId: input.approvedByUserId || null,
          createdByUserId: session.userId,
        },
      });

      if (charge) {
        const existingAdjustmentTotal = charge.adjustments.reduce((sum, item) => sum + Number(item.amount), 0);
        const nextBalance = Number(charge.amountDue) - Number(charge.amountPaid) - existingAdjustmentTotal - input.amount;
        await tx.duesCharge.update({
          where: { id: charge.id },
          data: {
            status: nextBalance <= 0 && input.adjustmentType === "WAIVER" ? "WAIVED" : nextBalance <= 0 ? "PAID" : charge.status,
          },
        });
      }

      return row;
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "dues.adjustment",
      entityType: "dues_adjustment",
      entityId: adjustment.id,
      metadata: {
        memberId: member.id,
        duesChargeId,
        adjustmentType: adjustment.adjustmentType,
        amount: adjustment.amount.toString(),
        reason: adjustment.reason,
      },
    });

    await createMemberTimelineEvent({
      organizationId,
      memberId: member.id,
      eventType: "UPDATED",
      title: "Dues adjustment recorded",
      description: input.reason.trim(),
      newValue: {
        duesAdjustmentId: adjustment.id,
        duesChargeId,
        adjustmentType: adjustment.adjustmentType,
        amount: adjustment.amount.toString(),
      },
      createdByUserId: session.userId,
    });

    return Response.json({ ok: true, data: adjustment }, { status: 201 });
  });
}
