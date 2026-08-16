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
 *    charge.refunded webhook;
 *  - idempotency is keyed on Stripe's own `refund.id` via a UNIQUE
 *    constraint on ContributionRefundEvent.providerRefundId — never on
 *    equality against the single most-recently-applied id (that scheme
 *    silently dropped a second, genuinely different partial refund whose
 *    identity happened to collide with the first, discovered 2026-08 and
 *    reproduced live against a real Stripe test-mode charge). `charge.id`
 *    is NEVER an acceptable refund identity fallback — it's shared by every
 *    refund on that charge, so it can never distinguish them;
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

  // CONNECT-F (§45): the refundable ceiling is what was actually CHARGED
  // (base + any processing-cost coverage), not just the fund-principal
  // `amount` — otherwise a covered contributor's coverage could never be
  // refunded. Falls back to `amount` on rows with no totalChargedAmount
  // (legacy/manual — identical to pre-CONNECT-F behavior).
  const original = Number(contribution.totalChargedAmount ?? contribution.amount);
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
      status: refund.status,
      source: "issue_refund_sync",
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

/** Provider-truth application for ONE real Stripe refund — called from
 * issueRefund (synchronous success) and from the charge.refunded webhook
 * (once per refund on the charge, see the webhook route). Idempotent on
 * `providerRefundId` via ContributionRefundEvent's unique constraint: a
 * replay of the same refund.id is a guaranteed no-op regardless of how many
 * OTHER refunds have landed on this contribution since. Never call this with
 * a synthetic/charge-derived id — it must be Stripe's own `refund.id`. */
export async function applyProviderRefund(input: {
  organizationId: string;
  providerPaymentIntentId: string;
  providerRefundId: string;
  amountRefundedCents: number;
  /** Stripe's refund.status. Only "succeeded" moves money; anything else
   *  (pending/requires_action/failed/canceled) is recorded nowhere yet —
   *  a later refund.updated/charge.refunded delivery applies it once it
   *  actually succeeds. */
  status: string;
  /** Caller tag for observability only (e.g. "issue_refund_sync",
   *  "charge.refunded") — never used for identity or dedup. */
  source: string;
  reason?: string | null;
  refundedByUserId?: string | null;
}): Promise<"APPLIED" | "DUPLICATE" | "NOT_FOUND" | "NOT_SUCCEEDED"> {
  const contribution = await prisma.contribution.findFirst({
    where: { organizationId: input.organizationId, providerPaymentIntentId: input.providerPaymentIntentId },
  });
  if (!contribution) {
    // A refund event that can't be matched to any contribution — never
    // fabricate a financial record for it. Observable, never fatal: the
    // webhook still 200s (nothing to retry).
    logGivingEvent("GIVING_REFUND_UNMATCHED", { organizationId: input.organizationId, source: input.source });
    return "NOT_FOUND";
  }
  if (input.status !== "succeeded") {
    logGivingEvent("GIVING_REFUND_NOT_SUCCEEDED", {
      organizationId: input.organizationId,
      contributionId: contribution.id,
      status: input.status,
      source: input.source,
    });
    return "NOT_SUCCEEDED";
  }

  const originalCents = Math.round(Number(contribution.totalChargedAmount ?? contribution.amount) * 100);
  const priorCents = Math.round(Number(contribution.refundedAmount ?? 0) * 100);
  // Financial invariant: 0 <= totalRefunded <= originalAmount, always —
  // clamp even if a malformed/duplicate-in-substance amount reached here.
  const nextCents = Math.min(priorCents + Math.max(0, input.amountRefundedCents), originalCents);

  try {
    await prisma.$transaction([
      prisma.contributionRefundEvent.create({
        data: {
          organizationId: input.organizationId,
          contributionId: contribution.id,
          providerRefundId: input.providerRefundId,
          amountCents: input.amountRefundedCents,
          status: input.status,
          source: input.source,
        },
      }),
      prisma.contribution.update({
        where: { id: contribution.id },
        data: {
          refundedAmount: new Prisma.Decimal((nextCents / 100).toFixed(2)),
          refundedAt: new Date(),
          providerRefundId: input.providerRefundId,
          ...(input.reason ? { refundReason: input.reason } : {}),
          ...(input.refundedByUserId ? { refundedByUserId: input.refundedByUserId } : {}),
        },
      }),
    ]);
  } catch (err) {
    // Unique-constraint violation on providerRefundId: this exact Stripe
    // refund was already applied (event replay). A DIFFERENT refund.id on
    // the same charge/contribution is a fresh insert, not a collision.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      logGivingEvent("GIVING_REFUND_DUPLICATE_IGNORED", {
        organizationId: input.organizationId,
        contributionId: contribution.id,
        source: input.source,
      });
      return "DUPLICATE";
    }
    throw err;
  }

  logGivingEvent("GIVING_REFUND_COMPLETED", {
    organizationId: input.organizationId,
    contributionId: contribution.id,
    amountCents: input.amountRefundedCents,
    source: input.source,
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
