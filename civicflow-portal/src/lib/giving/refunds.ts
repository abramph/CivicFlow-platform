import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";
import { logGivingEvent } from "./telemetry";

/**
 * CORE-GIVE-K — refunds (§34), disputes (§35), and controlled adjustments
 * (§100). THE RULES:
 *  - `amount` is immutable forever; a refund records provider-confirmed
 *    refund state alongside it and reports subtract;
 *  - a row is marked refunded ONLY from provider truth: the synchronous
 *    Stripe response when already `succeeded`, otherwise the
 *    charge.refunded webhook (idempotent on providerRefundId);
 *  - adjustments never touch money fields — fund reclassification and
 *    attribution correction only, with a permanent before/after trail;
 *  - disputed rows are never hidden or removed.
 */

export async function issueRefund(input: {
  organizationId: string;
  contributionId: string;
  amount?: number | null;
  reason: string;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  await ensureContributionsEnabled(input.organizationId);
  const reason = input.reason.trim();
  if (!reason) throw new FinanceError("A reason is required to refund.");

  const contribution = await prisma.contribution.findFirst({
    where: { id: input.contributionId, organizationId: input.organizationId },
  });
  if (!contribution) throw new FinanceError("Contribution not found.", 404);
  if (contribution.voidedAt) throw new FinanceError("A voided contribution cannot be refunded.", 409);
  if (!contribution.providerPaymentIntentId || contribution.paymentMethod !== "STRIPE") {
    throw new FinanceError("Only provider (card) contributions can be refunded here — correct offline entries in Giving Operations.", 409);
  }

  const original = Number(contribution.amount);
  const alreadyRefunded = Number(contribution.refundedAmount ?? 0);
  const requested = input.amount != null ? Math.round(input.amount * 100) / 100 : original - alreadyRefunded;
  if (!(requested > 0)) throw new FinanceError("Refund amount must be greater than zero.");
  if (alreadyRefunded + requested > original + 0.001) {
    throw new FinanceError(
      `Refunds cannot exceed the original amount ($${original.toFixed(2)}; $${alreadyRefunded.toFixed(2)} already refunded).`,
      409
    );
  }

  // CONNECT-C (§17/§56): refund against the SAME connected account that
  // owns the original charge, resolved from the contribution's own
  // immutable stripeConnectedAccountId — never from the organization's
  // CURRENT Stripe settings (which may have changed since the charge).
  const stripeAccountOptions =
    contribution.providerAccountContext === "CONNECTED_ACCOUNT_PAYMENT" && contribution.stripeConnectedAccountId
      ? { stripeAccount: contribution.stripeConnectedAccountId }
      : undefined;
  let stripe;
  if (stripeAccountOptions) {
    const { getStripeForMode } = await import("@/lib/payments/stripe-connect");
    const accountRow = await prisma.organizationStripeAccount.findUnique({
      where: { stripeAccountId: contribution.stripeConnectedAccountId as string },
      select: { accountMode: true },
    });
    stripe = await getStripeForMode((accountRow?.accountMode as "test" | "live") ?? "live");
  } else {
    const { getStripe } = await import("@/lib/stripe");
    stripe = getStripe();
  }
  const refund = await stripe.refunds.create(
    {
      payment_intent: contribution.providerPaymentIntentId,
      amount: Math.round(requested * 100),
      metadata: { organizationId: input.organizationId, contributionId: contribution.id, paymentType: "giving-refund" },
    },
    stripeAccountOptions
  );

  // §34: mark ONLY on provider confirmation. Stripe card refunds usually
  // confirm synchronously; anything else waits for charge.refunded.
  let marked = false;
  if (refund.status === "succeeded") {
    await applyProviderRefund({
      organizationId: input.organizationId,
      providerPaymentIntentId: contribution.providerPaymentIntentId,
      providerRefundId: refund.id,
      amountRefundedCents: refund.amount,
      reason,
      refundedByUserId: input.actorUserId,
    });
    marked = true;
  } else {
    // Store intent context so the webhook path can attach the reason/actor.
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { refundReason: reason, refundedByUserId: input.actorUserId },
    });
  }

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "giving.refund_issued",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: { providerRefundId: refund.id, amountCents: refund.amount, providerStatus: refund.status ?? "unknown", reason },
  });
  return { providerRefundId: refund.id, providerStatus: refund.status ?? "unknown", marked };
}

/** Provider-truth application — called from issueRefund (synchronous
 * success) and from the charge.refunded webhook. Idempotent on
 * providerRefundId; cumulative amount comes from the provider. */
export async function applyProviderRefund(input: {
  organizationId: string;
  providerPaymentIntentId: string;
  providerRefundId: string;
  /** "increment": one refund's amount (the synchronous path).
   *  "cumulative": the charge's total amount_refunded (the webhook path —
   *  Stripe reports the running total there). */
  amountRefundedCents: number;
  mode?: "increment" | "cumulative";
  reason?: string | null;
  refundedByUserId?: string | null;
}): Promise<"APPLIED" | "DUPLICATE" | "NOT_FOUND"> {
  const contribution = await prisma.contribution.findFirst({
    where: { organizationId: input.organizationId, providerPaymentIntentId: input.providerPaymentIntentId },
  });
  if (!contribution) return "NOT_FOUND";
  if (contribution.providerRefundId === input.providerRefundId && contribution.refundedAt) return "DUPLICATE";

  const originalCents = Math.round(Number(contribution.amount) * 100);
  const priorCents = Math.round(Number(contribution.refundedAmount ?? 0) * 100);
  const cumulativeCents =
    input.mode === "cumulative"
      ? Math.min(Math.max(input.amountRefundedCents, priorCents), originalCents)
      : Math.min(priorCents + input.amountRefundedCents, originalCents);
  await prisma.contribution.update({
    where: { id: contribution.id },
    data: {
      refundedAmount: new Prisma.Decimal((cumulativeCents / 100).toFixed(2)),
      refundedAt: new Date(),
      providerRefundId: input.providerRefundId,
      ...(input.reason ? { refundReason: input.reason } : {}),
      ...(input.refundedByUserId ? { refundedByUserId: input.refundedByUserId } : {}),
    },
  });
  logGivingEvent("GIVING_REFUND_COMPLETED", {
    organizationId: input.organizationId,
    contributionId: contribution.id,
    amountCents: input.amountRefundedCents,
  });
  return "APPLIED";
}

/** §35 — mirror the provider's dispute state; never hide the row. */
export async function applyDisputeStatus(input: {
  organizationId: string;
  providerPaymentIntentId: string;
  disputeStatus: string;
}): Promise<"APPLIED" | "NOT_FOUND"> {
  const contribution = await prisma.contribution.findFirst({
    where: { organizationId: input.organizationId, providerPaymentIntentId: input.providerPaymentIntentId },
    select: { id: true },
  });
  if (!contribution) return "NOT_FOUND";
  await prisma.contribution.update({
    where: { id: contribution.id },
    data: { providerDisputeStatus: input.disputeStatus.slice(0, 60) },
  });
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: null,
    action: "giving.dispute_status_changed",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: { disputeStatus: input.disputeStatus.slice(0, 60) },
  });
  return "APPLIED";
}

/** §100 — controlled adjustment: money fields untouchable, permanent trail. */
export async function adjustContribution(input: {
  organizationId: string;
  contributionId: string;
  kind: "FUND_RECLASSIFICATION" | "ATTRIBUTION_CORRECTION";
  newFundId?: string | null;
  newMemberId?: string | null;
  newContributorName?: string | null;
  reason: string;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  await ensureContributionsEnabled(input.organizationId);
  const reason = input.reason.trim();
  if (!reason) throw new FinanceError("A reason is required for an adjustment.");
  const contribution = await prisma.contribution.findFirst({
    where: { id: input.contributionId, organizationId: input.organizationId },
  });
  if (!contribution) throw new FinanceError("Contribution not found.", 404);
  if (contribution.voidedAt) throw new FinanceError("A voided contribution cannot be adjusted.", 409);

  let before: Record<string, string | null>;
  let after: Record<string, string | null>;
  let update: Prisma.ContributionUpdateInput;

  if (input.kind === "FUND_RECLASSIFICATION") {
    if (!input.newFundId) throw new FinanceError("A destination fund is required.");
    const fund = await prisma.fund.findFirst({ where: { id: input.newFundId, organizationId: input.organizationId } });
    if (!fund) throw new FinanceError("Fund not found.", 404);
    if (fund.status === "ARCHIVED" || fund.status === "CLOSED") {
      throw new FinanceError(`"${fund.name}" is not open — reclassification targets must be usable funds.`, 409);
    }
    if (fund.id === contribution.fundId) throw new FinanceError("The contribution is already in that fund.", 409);
    before = { fundId: contribution.fundId };
    after = { fundId: fund.id };
    update = { fund: { connect: { id: fund.id } } };
  } else {
    const member = input.newMemberId
      ? await prisma.orgMember.findFirst({ where: { id: input.newMemberId, organizationId: input.organizationId } })
      : null;
    if (input.newMemberId && !member) throw new FinanceError("Member not found.", 404);
    before = { memberId: contribution.memberId, contributorName: contribution.contributorName };
    after = { memberId: member?.id ?? null, contributorName: input.newContributorName?.trim() || null };
    update = {
      member: member ? { connect: { id: member.id } } : { disconnect: true },
      contributorName: input.newContributorName?.trim() || null,
      ...(member?.userId ? { contributorUserId: member.userId } : {}),
    };
  }

  const [adjustment] = await prisma.$transaction([
    prisma.contributionAdjustment.create({
      data: {
        organizationId: input.organizationId,
        contributionId: contribution.id,
        kind: input.kind,
        before,
        after,
        reason,
        actorUserId: input.actorUserId,
      },
    }),
    prisma.contribution.update({ where: { id: contribution.id }, data: update }),
  ]);

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "giving.contribution_adjusted",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: { kind: input.kind, adjustmentId: adjustment.id, before, after, reason },
  });
  return adjustment;
}
