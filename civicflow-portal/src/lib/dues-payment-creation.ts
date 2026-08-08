import type { DuesPaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { recordDuesPayment } from "@/lib/dues-payments";
import { z } from "@/lib/validation";

/**
 * Shared "staff records a dues payment" orchestration — member/charge/
 * account resolution and cross-checks, then delegates the actual write to
 * recordDuesPayment(). Used by the web /api/dues/payments route and the
 * mobile admin equivalent so neither surface can drift on which
 * charge/account/member a payment ends up attached to.
 */

const PAYMENT_METHOD_VALUES = [
  "CASH",
  "CHECK",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "CARD",
  "ACH",
  "ZELLE",
  "CASH_APP",
  "VENMO",
  "PAYPAL",
  "STRIPE",
  "ZEFFY",
  "OTHER",
] as const;

export const createDuesPaymentSchema = z.object({
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  duesChargeId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  duesAccountId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  amount: z.number().positive(),
  paymentDate: z.string().datetime(),
  paymentMethodId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  method: z.enum(PAYMENT_METHOD_VALUES).optional(),
  reference: z.union([z.string().max(120), z.literal(""), z.null()]).optional(),
  referenceNumber: z.union([z.string().max(120), z.literal(""), z.null()]).optional(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
});
export type CreateDuesPaymentInput = z.infer<typeof createDuesPaymentSchema>;

export interface DuesPaymentActor {
  userId: string;
  userEmail?: string | null;
}

export type CreateDuesPaymentResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function resolveAndRecordDuesPayment(
  organizationId: string,
  actor: DuesPaymentActor,
  input: CreateDuesPaymentInput
): Promise<CreateDuesPaymentResult<Awaited<ReturnType<typeof recordDuesPayment>>>> {
  const duesChargeId = input.duesChargeId || null;
  const duesAccountIdFromInput = input.duesAccountId || null;
  const reference =
    typeof (input.reference ?? input.referenceNumber) === "string"
      ? (input.reference ?? input.referenceNumber ?? "").trim() || null
      : (input.reference ?? input.referenceNumber ?? null);
  const notes = typeof input.notes === "string" ? input.notes.trim() || null : (input.notes ?? null);

  let charge: Awaited<ReturnType<typeof prisma.duesCharge.findFirst>> = null;
  let account: Awaited<ReturnType<typeof prisma.duesAccount.findFirst>> = null;

  if (duesChargeId) {
    charge = await prisma.duesCharge.findFirst({ where: { id: duesChargeId, organizationId }, include: { duesAccount: true } });
    if (!charge) return { ok: false, status: 404, error: "Dues charge not found in organization" };
  }

  const resolvedDuesAccountId = duesAccountIdFromInput ?? charge?.duesAccountId ?? null;
  if (resolvedDuesAccountId) {
    account = await prisma.duesAccount.findFirst({ where: { id: resolvedDuesAccountId, organizationId } });
    if (!account) return { ok: false, status: 404, error: "Dues account not found in organization" };
  }

  const resolvedMemberId = input.memberId || charge?.memberId || account?.memberId || null;
  if (!resolvedMemberId) {
    return { ok: false, status: 400, error: "Member is required unless the selected charge or account resolves to a member." };
  }

  const member = await prisma.orgMember.findFirst({ where: { id: resolvedMemberId, organizationId } });
  if (!member) return { ok: false, status: 404, error: "Member not found in organization" };

  if (charge && charge.memberId !== resolvedMemberId) {
    return { ok: false, status: 400, error: "The selected dues charge belongs to a different member." };
  }
  if (account?.memberId && account.memberId !== resolvedMemberId) {
    return { ok: false, status: 400, error: "The selected dues account belongs to a different member." };
  }

  let resolvedMethod: DuesPaymentMethod = input.method ?? "CASH";
  if (input.paymentMethodId) {
    const paymentMethod = await prisma.paymentMethodConfig.findFirst({
      where: { id: input.paymentMethodId, organizationId, isActive: true },
    });
    if (!paymentMethod) return { ok: false, status: 404, error: "Payment method not found in organization" };
    resolvedMethod = paymentMethod.method;
  }

  const row = await recordDuesPayment({
    organizationId,
    memberId: resolvedMemberId,
    duesChargeId,
    duesAccountId: resolvedDuesAccountId,
    amount: input.amount,
    paymentDate: new Date(input.paymentDate),
    method: resolvedMethod,
    reference,
    notes,
    charge,
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "payment",
    entityType: "dues_payment",
    entityId: row.id,
    metadata: {
      amount: row.amount.toString(),
      method: row.method,
      paymentDate: row.paymentDate.toISOString(),
      duesChargeId: row.duesChargeId,
      duesAccountId: row.duesAccountId,
    },
  });

  await createMemberTimelineEvent({
    organizationId,
    memberId: row.memberId,
    eventType: "PAYMENT_RECORDED",
    title: "Dues payment recorded",
    newValue: { duesPaymentId: row.id, amount: row.amount.toString(), method: row.method, duesChargeId: row.duesChargeId, duesAccountId: row.duesAccountId },
    occurredAt: row.paymentDate,
    createdByUserId: actor.userId,
  });

  return { ok: true, data: row };
}
