import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { adjustPtaVolunteerHourEntry } from "../volunteers";
import { resolveHouseholdRequirement } from "./assignments";
import { getHouseholdLedgerTotals, postLedgerEntry } from "./ledger";

/**
 * Corrections, reversals & refunds (spec §21) — VH-H. THE RULE throughout:
 * a correction never auto-charges, a refund never auto-issues without an
 * explicit admin action, and every case that could create a financial
 * surprise surfaces a PtaVolunteerReviewFlag for a human instead of
 * resolving itself. Nothing here mutates a prior record — every function
 * either delegates to an existing append-only correction path
 * (adjustPtaVolunteerHourEntry) or posts a new, separate ledger entry.
 */

async function createReviewFlag(input: {
  organizationId: string;
  requirementPeriodId: string;
  householdId: string;
  flagType: "CORRECTION_AFTER_ASSESSMENT_POSTED" | "POTENTIAL_OVERPAYMENT_AFTER_REQUIREMENT_REDUCED" | "REFUND_CREATES_DEFICIT";
  description: string;
  sourceType?: string | null;
  sourceId?: string | null;
}) {
  const flag = await prisma.ptaVolunteerReviewFlag.create({
    data: {
      organizationId: input.organizationId,
      requirementPeriodId: input.requirementPeriodId,
      householdId: input.householdId,
      flagType: input.flagType,
      description: input.description,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    action: "pta.volunteer_hours.review_flag_created",
    entityType: "pta_volunteer_review_flag",
    entityId: flag.id,
    metadata: { flagType: input.flagType, householdId: input.householdId },
  });
  return flag;
}

/**
 * Corrects/reverses an already-approved hour entry via the existing
 * append-only adjustment path (which also mirrors a CORRECTED ledger entry
 * — see VH-D's wiring in volunteers.ts). If the household already has a
 * POSTED assessment charge for the applicable period, the correction still
 * proceeds (recalculating totals) but is flagged for administrator review
 * rather than triggering any automatic supplemental charge or refund.
 */
export async function reverseHourEntry(
  organizationId: string,
  entryId: string,
  minuteAdjustment: number,
  reason: string,
  actor: { userId: string; userEmail?: string | null }
) {
  const entry = await adjustPtaVolunteerHourEntry(organizationId, entryId, minuteAdjustment, reason, actor.userId, actor.userEmail);

  let flagged = false;
  if (entry.householdId) {
    const postedCharge = await prisma.ptaVolunteerAssessmentCharge.findFirst({
      where: { organizationId, householdId: entry.householdId },
    });
    if (postedCharge) {
      await createReviewFlag({
        organizationId,
        requirementPeriodId: postedCharge.requirementPeriodId,
        householdId: entry.householdId,
        flagType: "CORRECTION_AFTER_ASSESSMENT_POSTED",
        description: `Hour entry ${entryId} was adjusted by ${minuteAdjustment} minutes after an assessment was already posted for this family. Review whether a supplemental adjustment is warranted — nothing was charged or refunded automatically.`,
        sourceType: "hourEntry",
        sourceId: entryId,
      });
      flagged = true;
    }
  }

  return { entry, flagged };
}

export interface RefundPurchasedHoursResult {
  refundedMinutes: number;
  refundedAmountCents: number;
  deficitWarning: boolean;
}

/**
 * Reverses a purchased-hour credit — full or partial. Stripe-paid purchases
 * are refunded through Stripe against the SAME connected account that owns
 * the original charge (never the org's current settings); offline-paid
 * purchases are refunded as a pure record with no provider call. Marks the
 * refund only on Stripe's synchronous "succeeded" response — this program
 * deliberately does not add a charge.refunded webhook confirmation path in
 * V1 (documented simplification, same posture as VH-F's checkout-time rate
 * lock); a refund that comes back non-succeeded is recorded as attempted
 * but not yet confirmed, matching how giving/refunds.ts treats the
 * non-synchronous case.
 */
export async function refundPurchasedHours(
  organizationId: string,
  purchaseId: string,
  input: { refundMinutes: number; refundAmountCents: number; reason: string },
  actor: { userId: string; userEmail?: string | null }
): Promise<RefundPurchasedHoursResult> {
  if (!input.reason.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "A reason is required to refund purchased hours.");
  if (input.refundMinutes <= 0 || input.refundAmountCents <= 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Refund minutes and amount must both be greater than zero.");
  }

  const purchase = await prisma.ptaVolunteerBuyoutPurchase.findFirst({ where: { id: purchaseId, organizationId } });
  if (!purchase) throw new PtaError("PTA_VALIDATION_ERROR", "Purchase not found in this organization.");
  if (purchase.status !== "COMPLETED" && purchase.status !== "REFUNDED") {
    throw new PtaError("PTA_VALIDATION_ERROR", "Only a completed purchase can be refunded.");
  }
  const remainingRefundableMinutes = purchase.hoursElectedMinutes - purchase.refundedMinutes;
  const remainingRefundableCents = purchase.totalCents - purchase.refundedAmountCents;
  if (input.refundMinutes > remainingRefundableMinutes) {
    throw new PtaError("PTA_VALIDATION_ERROR", `Cannot refund more than the ${remainingRefundableMinutes} minutes still refundable.`);
  }
  if (input.refundAmountCents > remainingRefundableCents) {
    throw new PtaError("PTA_VALIDATION_ERROR", `Cannot refund more than the $${(remainingRefundableCents / 100).toFixed(2)} still refundable.`);
  }

  let providerRefundId: string | null = null;
  if (purchase.paymentMethod === "STRIPE") {
    if (!purchase.providerPaymentIntentId || !purchase.stripeConnectedAccountId) {
      throw new PtaError("PTA_VALIDATION_ERROR", "This Stripe purchase is missing payment details and cannot be refunded here.");
    }
    const { getStripeForMode } = await import("@/lib/payments/stripe-connect");
    const accountRow = await prisma.organizationStripeAccount.findUnique({
      where: { stripeAccountId: purchase.stripeConnectedAccountId },
      select: { accountMode: true },
    });
    const stripe = await getStripeForMode((accountRow?.accountMode as "test" | "live") ?? "live");
    const refund = await stripe.refunds.create(
      {
        payment_intent: purchase.providerPaymentIntentId,
        amount: input.refundAmountCents,
        metadata: { organizationId, purchaseId: purchase.id, paymentType: "pta-volunteer-buyout-refund" },
      },
      { stripeAccount: purchase.stripeConnectedAccountId }
    );
    providerRefundId = refund.id;
  }

  const newRefundedMinutes = purchase.refundedMinutes + input.refundMinutes;
  const newRefundedAmountCents = purchase.refundedAmountCents + input.refundAmountCents;
  const fullyRefunded = newRefundedMinutes >= purchase.hoursElectedMinutes;

  await prisma.ptaVolunteerBuyoutPurchase.update({
    where: { id: purchase.id },
    data: { refundedMinutes: newRefundedMinutes, refundedAmountCents: newRefundedAmountCents, status: fullyRefunded ? "REFUNDED" : purchase.status },
  });

  const refundSourceId = providerRefundId ?? `offline-refund-${purchase.id}-${Date.now()}`;
  await postLedgerEntry({
    organizationId,
    requirementPeriodId: purchase.requirementPeriodId,
    householdId: purchase.householdId,
    entryType: "PURCHASE_REFUND",
    minutes: input.refundMinutes,
    amountCents: input.refundAmountCents,
    approvalStatus: "APPROVED",
    sourceType: "buyoutPurchaseRefund",
    sourceId: refundSourceId,
    reason: input.reason,
    createdByUserId: actor.userId,
    description: `Refund of ${(input.refundMinutes / 60).toString()}h / $${(input.refundAmountCents / 100).toFixed(2)}`,
  });
  await postLedgerEntry({
    organizationId,
    requirementPeriodId: purchase.requirementPeriodId,
    householdId: purchase.householdId,
    entryType: "REFUND",
    amountCents: input.refundAmountCents,
    approvalStatus: "APPROVED",
    sourceType: "buyoutPurchaseRefundPayment",
    sourceId: refundSourceId,
    reason: input.reason,
    createdByUserId: actor.userId,
  });

  // spec §21: "warn administrators if the refund creates a deficit" — the
  // household now needs to make up hours it previously had covered by this
  // purchase. Never blocks the refund; purely informational.
  const requirement = await resolveHouseholdRequirement(organizationId, purchase.requirementPeriodId, purchase.householdId);
  const totals = await getHouseholdLedgerTotals(organizationId, purchase.requirementPeriodId, purchase.householdId);
  const remainingMinutes = Math.max(
    0,
    requirement.requiredMinutes - totals.verifiedMinutes - totals.purchasedMinutes - totals.creditMinutes - totals.waivedMinutes
  );
  const deficitWarning = remainingMinutes > 0;
  if (deficitWarning) {
    await createReviewFlag({
      organizationId,
      requirementPeriodId: purchase.requirementPeriodId,
      householdId: purchase.householdId,
      flagType: "REFUND_CREATES_DEFICIT",
      description: `Refunding ${(input.refundMinutes / 60).toString()}h from purchase ${purchase.id} leaves this family with ${(remainingMinutes / 60).toString()}h still required.`,
      sourceType: "buyoutPurchase",
      sourceId: purchase.id,
    });
  }

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.purchase_refunded",
    entityType: "pta_volunteer_buyout_purchase",
    entityId: purchase.id,
    metadata: { refundMinutes: input.refundMinutes, refundAmountCents: input.refundAmountCents, reason: input.reason, deficitWarning },
  });

  return { refundedMinutes: input.refundMinutes, refundedAmountCents: input.refundAmountCents, deficitWarning };
}

export interface OverpaymentCheckResult {
  overpaymentDetected: boolean;
  requiredMinutes: number;
  satisfiedMinutes: number;
  excessMinutes: number;
}

/**
 * spec §21: "if a requirement is reduced after payment, show potential
 * excess purchased hours or overpayment... require administrator review...
 * do not issue an automatic refund without authorization." Called
 * explicitly (from the assignment-rules UI, after an admin creates a
 * requirement-reducing HOUSEHOLD assignment) rather than wired into
 * assignments.ts itself, keeping VH-B's tested create path untouched.
 */
export async function checkForOverpaymentAfterRequirementChange(
  organizationId: string,
  periodId: string,
  householdId: string
): Promise<OverpaymentCheckResult> {
  const requirement = await resolveHouseholdRequirement(organizationId, periodId, householdId);
  const totals = await getHouseholdLedgerTotals(organizationId, periodId, householdId);
  const satisfiedMinutes = totals.verifiedMinutes + totals.purchasedMinutes + totals.creditMinutes + totals.waivedMinutes;
  const excessMinutes = Math.max(0, satisfiedMinutes - requirement.requiredMinutes);
  const overpaymentDetected = excessMinutes > 0 && totals.purchasedMinutes > 0;

  if (overpaymentDetected) {
    await createReviewFlag({
      organizationId,
      requirementPeriodId: periodId,
      householdId,
      flagType: "POTENTIAL_OVERPAYMENT_AFTER_REQUIREMENT_REDUCED",
      description: `This family's requirement is now ${(requirement.requiredMinutes / 60).toString()}h but they have ${(satisfiedMinutes / 60).toString()}h satisfied (including ${(totals.purchasedMinutes / 60).toString()}h purchased) — a possible overpayment of ${(excessMinutes / 60).toString()}h. No refund has been issued automatically.`,
    });
  }

  return { overpaymentDetected, requiredMinutes: requirement.requiredMinutes, satisfiedMinutes, excessMinutes };
}

export async function listReviewFlags(organizationId: string, periodId: string) {
  return prisma.ptaVolunteerReviewFlag.findMany({ where: { organizationId, requirementPeriodId: periodId }, orderBy: { createdAt: "desc" } });
}

export async function resolveReviewFlag(organizationId: string, flagId: string, resolutionNotes: string | null, actor: { userId: string }) {
  const existing = await prisma.ptaVolunteerReviewFlag.findFirst({ where: { id: flagId, organizationId } });
  if (!existing) throw new PtaError("PTA_VALIDATION_ERROR", "Review flag not found in this organization.");

  const flag = await prisma.ptaVolunteerReviewFlag.update({
    where: { id: flagId },
    data: { status: "RESOLVED", resolvedByUserId: actor.userId, resolvedAt: new Date(), resolutionNotes: resolutionNotes?.trim() || null },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "pta.volunteer_hours.review_flag_resolved",
    entityType: "pta_volunteer_review_flag",
    entityId: flag.id,
    metadata: { resolutionNotes },
  });

  return flag;
}
