import type { DuesPaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Creates a DuesPayment row and, if it's applied to a specific charge,
 * updates that charge's amountPaid/status in the same transaction.
 * Shared by the staff dues-payments API and the member payment-report
 * approval flow so charge balance math only lives in one place.
 */
export async function recordDuesPayment(params: {
  organizationId: string;
  memberId: string;
  duesChargeId?: string | null;
  duesAccountId?: string | null;
  amount: number;
  paymentDate: Date;
  method: DuesPaymentMethod;
  reference?: string | null;
  notes?: string | null;
  /** Pass the already-validated charge to have its balance updated. */
  charge?: { id: string; amountPaid: unknown; amountDue: unknown } | null;
}) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.duesPayment.create({
      data: {
        organizationId: params.organizationId,
        memberId: params.memberId,
        duesChargeId: params.duesChargeId ?? null,
        duesAccountId: params.duesAccountId ?? null,
        amount: params.amount,
        paymentDate: params.paymentDate,
        method: params.method,
        reference: params.reference ?? null,
        notes: params.notes ?? null,
      },
    });

    if (params.charge) {
      const nextAmountPaid = Number(params.charge.amountPaid) + params.amount;
      const amountDue = Number(params.charge.amountDue);
      const nextStatus = nextAmountPaid <= 0 ? "PENDING" : nextAmountPaid >= amountDue ? "PAID" : "PARTIAL";

      await tx.duesCharge.update({
        where: { id: params.charge.id },
        data: { amountPaid: nextAmountPaid, status: nextStatus },
      });
    }

    return payment;
  });
}
