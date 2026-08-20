import type { PaymentNature, PendingPayment, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * COST-POLICY v2 (§7): first-party pending payment/allocation records.
 * Persisted BEFORE the payer is redirected to Stripe, so Unestra's own
 * statement of (obligation, coverage, total) exists independently of Stripe
 * session metadata. The webhook settles against THIS record; metadata
 * remains a legacy cross-check for sessions that predate the branch.
 */

export interface CreatePendingPaymentInput {
  organizationId: string;
  memberId?: string | null;
  contributorUserId?: string | null;
  paymentPurpose: string;
  paymentNature: PaymentNature;
  duesChargeId?: string | null;
  paymentLinkId?: string | null;
  fundId?: string | null;
  contributionProgramId?: string | null;
  obligationCents: number;
  processingCostCents: number;
  coverageMode: string;
  coverageRequired: boolean;
  coveragePolicyVersion?: string | null;
  stripeConnectedAccountId: string;
}

/** §4 invariants enforced at write time — impossible allocations never
 * reach the database. */
function assertInvariants(input: CreatePendingPaymentInput) {
  if (!Number.isInteger(input.obligationCents) || input.obligationCents <= 0) {
    throw new Error("PendingPayment: obligationCents must be a positive integer");
  }
  if (!Number.isInteger(input.processingCostCents) || input.processingCostCents < 0) {
    throw new Error("PendingPayment: processingCostCents must be a non-negative integer");
  }
}

export async function createPendingPayment(input: CreatePendingPaymentInput): Promise<PendingPayment> {
  assertInvariants(input);
  return prisma.pendingPayment.create({
    data: {
      organizationId: input.organizationId,
      memberId: input.memberId ?? null,
      contributorUserId: input.contributorUserId ?? null,
      paymentPurpose: input.paymentPurpose,
      paymentNature: input.paymentNature,
      duesChargeId: input.duesChargeId ?? null,
      paymentLinkId: input.paymentLinkId ?? null,
      fundId: input.fundId ?? null,
      contributionProgramId: input.contributionProgramId ?? null,
      obligationCents: input.obligationCents,
      processingCostCents: input.processingCostCents,
      totalCents: input.obligationCents + input.processingCostCents,
      coverageMode: input.coverageMode,
      coverageRequired: input.coverageRequired,
      coveragePolicyVersion: input.coveragePolicyVersion ?? null,
      stripeConnectedAccountId: input.stripeConnectedAccountId,
    },
  });
}

export async function attachStripeSession(pendingPaymentId: string, stripeSessionId: string) {
  await prisma.pendingPayment.update({
    where: { id: pendingPaymentId },
    data: { stripeSessionId },
  });
}

export type PendingSettlement =
  | { outcome: "NOT_FOUND" }
  | { outcome: "ALREADY_COMPLETED"; record: PendingPayment }
  | { outcome: "MISMATCH"; record: PendingPayment; reason: string }
  | { outcome: "SETTLED"; record: PendingPayment };

/**
 * §10 — settle the pending record for a completed Checkout Session.
 * Verifies the paid total and connected account against what was
 * authorized; a mismatch records NOTHING downstream (the caller must skip
 * recording) and preserves the reason for review. Safe under webhook
 * replay: the compare-and-swap update makes exactly one settle win.
 */
export async function settlePendingPaymentBySession(input: {
  stripeSessionId: string;
  paidTotalCents: number;
  stripeConnectedAccountId: string;
  tx?: Prisma.TransactionClient;
}): Promise<PendingSettlement> {
  const db = input.tx ?? prisma;
  const record = await db.pendingPayment.findUnique({ where: { stripeSessionId: input.stripeSessionId } });
  if (!record) return { outcome: "NOT_FOUND" };
  if (record.status === "COMPLETED") return { outcome: "ALREADY_COMPLETED", record };

  const problems: string[] = [];
  if (record.totalCents !== input.paidTotalCents) {
    problems.push(`paid total ${input.paidTotalCents} != authorized total ${record.totalCents}`);
  }
  if (record.stripeConnectedAccountId !== input.stripeConnectedAccountId) {
    problems.push(`connected account ${input.stripeConnectedAccountId} != authorized ${record.stripeConnectedAccountId}`);
  }

  if (problems.length > 0) {
    const reason = problems.join("; ");
    const updated = await db.pendingPayment.update({
      where: { id: record.id },
      data: { status: "MISMATCHED", mismatchReason: reason },
    });
    return { outcome: "MISMATCH", record: updated, reason };
  }

  const settled = await db.pendingPayment.updateMany({
    where: { id: record.id, status: "PENDING" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  if (settled.count === 0) {
    // Lost a settle race — treat as the replay it is.
    const current = await db.pendingPayment.findUnique({ where: { id: record.id } });
    return current?.status === "COMPLETED"
      ? { outcome: "ALREADY_COMPLETED", record: current }
      : { outcome: "MISMATCH", record: current ?? record, reason: current?.mismatchReason ?? "unknown settle race" };
  }
  const fresh = await db.pendingPayment.findUnique({ where: { id: record.id } });
  return { outcome: "SETTLED", record: fresh ?? record };
}
