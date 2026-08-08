import type { DuesAdjustment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { z } from "@/lib/validation";

/**
 * Shared DuesAdjustment (credit/waiver/write-off) creation logic — used by
 * both the web portal route (src/app/api/dues/adjustments/route.ts) and the
 * mobile admin equivalent. Extracted so the charge-balance recompute only
 * lives in one place, same rationale as recordDuesPayment().
 */

export const createDuesAdjustmentSchema = z.object({
  memberId: z.string().min(1),
  duesChargeId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  adjustmentType: z.enum(["WAIVER", "DISCOUNT", "CREDIT", "WRITE_OFF", "MANUAL_ADJUSTMENT"]),
  amount: z.number().positive(),
  reason: z.string().trim().min(3).max(1000),
  approvedByUserId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
});
export type CreateDuesAdjustmentInput = z.infer<typeof createDuesAdjustmentSchema>;

export interface DuesAdjustmentActor {
  userId: string;
  userEmail?: string | null;
}

export type CreateDuesAdjustmentResult = { ok: true; data: DuesAdjustment } | { ok: false; status: number; error: string };

export async function createDuesAdjustment(
  organizationId: string,
  actor: DuesAdjustmentActor,
  input: CreateDuesAdjustmentInput
): Promise<CreateDuesAdjustmentResult> {
  const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
  if (!member) return { ok: false, status: 404, error: "Member not found in organization." };

  const duesChargeId = input.duesChargeId || null;
  const charge = duesChargeId
    ? await prisma.duesCharge.findFirst({ where: { id: duesChargeId, organizationId, memberId: member.id }, include: { adjustments: true } })
    : null;
  if (duesChargeId && !charge) {
    return { ok: false, status: 404, error: "Dues charge not found for this member." };
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
        createdByUserId: actor.userId,
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
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
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
    createdByUserId: actor.userId,
  });

  return { ok: true, data: adjustment };
}
