import type { DuesPaymentMethod, Prisma, ProviderAccountContext } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type TxClient = Prisma.TransactionClient;

interface RecordDuesPaymentParams {
  organizationId: string;
  memberId: string;
  duesChargeId?: string | null;
  duesAccountId?: string | null;
  amount: number;
  paymentDate: Date;
  method: DuesPaymentMethod;
  reference?: string | null;
  notes?: string | null;
  /** CONNECT-E (§56): immutable account attribution — only the Stripe
   * webhook path passes these; offline/manual entries leave them null. */
  stripeConnectedAccountId?: string | null;
  providerAccountContext?: ProviderAccountContext | null;
  /** Pass the already-validated charge to have its balance updated. */
  charge?: { id: string; amountPaid: unknown; amountDue: unknown } | null;
}

async function recordDuesPaymentWithClient(tx: TxClient, params: RecordDuesPaymentParams) {
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
      stripeConnectedAccountId: params.stripeConnectedAccountId ?? null,
      providerAccountContext: params.providerAccountContext ?? null,
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
}

/**
 * Creates a DuesPayment row and, if it's applied to a specific charge,
 * updates that charge's amountPaid/status in the same transaction.
 * Shared by the staff dues-payments API, the member payment-report
 * approval flow, and the mobile admin equivalents so charge balance math
 * only lives in one place.
 *
 * Pass `tx` when composing this inside a larger transaction (e.g. a
 * compare-and-swap claim on a PaymentReport that must roll back together
 * with the payment if the claim loses a race) — otherwise this opens its
 * own transaction, preserving the original standalone behavior.
 */
export async function recordDuesPayment(params: RecordDuesPaymentParams, tx?: TxClient) {
  if (tx) return recordDuesPaymentWithClient(tx, params);
  return prisma.$transaction((innerTx) => recordDuesPaymentWithClient(innerTx, params));
}
