import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";

const createDuesPaymentSchema = z.object({
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  duesChargeId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  duesAccountId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  amount: z.number().positive(),
  paymentDate: z.string().datetime(),
  paymentMethodId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  method: z.enum([
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
    "OTHER",
  ]).optional(),
  reference: z.union([z.string().max(120), z.literal(""), z.null()]).optional(),
  referenceNumber: z.union([z.string().max(120), z.literal(""), z.null()]).optional(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("dues:read", "throw");

    const rows = await prisma.duesPayment.findMany({
      where: { organizationId },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, duesCharge: true, duesAccount: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "dues_payment",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:dues:write",
      request,
      limit: 50,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, createDuesPaymentSchema);
    const duesChargeId = input.duesChargeId || null;
    const duesAccountIdFromInput = input.duesAccountId || null;
    const reference =
      typeof (input.reference ?? input.referenceNumber) === "string"
        ? (input.reference ?? input.referenceNumber ?? "").trim() || null
        : input.reference ?? input.referenceNumber ?? null;
    const notes = typeof input.notes === "string" ? input.notes.trim() || null : input.notes ?? null;

    let charge = null;
    let account = null;

    if (duesChargeId) {
      charge = await prisma.duesCharge.findFirst({
        where: { id: duesChargeId, organizationId },
        include: { duesAccount: true },
      });
      if (!charge) {
        return Response.json({ ok: false, error: "Dues charge not found in organization" }, { status: 404 });
      }
    }

    const resolvedDuesAccountId = duesAccountIdFromInput ?? charge?.duesAccountId ?? null;
    if (resolvedDuesAccountId) {
      account = await prisma.duesAccount.findFirst({
        where: { id: resolvedDuesAccountId, organizationId },
      });
      if (!account) {
        return Response.json({ ok: false, error: "Dues account not found in organization" }, { status: 404 });
      }
    }

    const resolvedMemberId = input.memberId || charge?.memberId || account?.memberId || null;
    if (!resolvedMemberId) {
      return Response.json(
        { ok: false, error: "Member is required unless the selected charge or account resolves to a member." },
        { status: 400 }
      );
    }

    const member = await prisma.orgMember.findFirst({ where: { id: resolvedMemberId, organizationId } });
    if (!member) {
      return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
    }

    if (charge) {
      if (charge.memberId !== resolvedMemberId) {
        return Response.json(
          { ok: false, error: "The selected dues charge belongs to a different member." },
          { status: 400 }
        );
      }
    }

    if (account?.memberId && account.memberId !== resolvedMemberId) {
      return Response.json(
        { ok: false, error: "The selected dues account belongs to a different member." },
        { status: 400 }
      );
    }

    let resolvedMethod = input.method ?? "CASH";
    if (input.paymentMethodId) {
      const paymentMethod = await prisma.paymentMethodConfig.findFirst({
        where: { id: input.paymentMethodId, organizationId, isActive: true },
      });
      if (!paymentMethod) {
        return Response.json({ ok: false, error: "Payment method not found in organization" }, { status: 404 });
      }
      resolvedMethod = paymentMethod.method;
    }

    const { row } = await prisma.$transaction(async (tx) => {
      const payment = await tx.duesPayment.create({
        data: {
          organizationId,
          memberId: resolvedMemberId,
          duesChargeId,
          duesAccountId: resolvedDuesAccountId,
          amount: input.amount,
          paymentDate: new Date(input.paymentDate),
          method: resolvedMethod,
          reference,
          notes,
        },
      });

      if (charge) {
        const nextAmountPaid = Number(charge.amountPaid) + input.amount;
        const amountDue = Number(charge.amountDue);
        const nextStatus =
          nextAmountPaid <= 0
            ? "PENDING"
            : nextAmountPaid >= amountDue
              ? "PAID"
              : "PARTIAL";

        await tx.duesCharge.update({
          where: { id: charge.id },
          data: {
            amountPaid: nextAmountPaid,
            status: nextStatus,
          },
        });
      }

      return { row: payment };
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
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
      createdByUserId: session.userId,
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
