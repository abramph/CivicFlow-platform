import { createAuditEvent } from "@/lib/audit";
import { getServerEnv } from "@/lib/env";
import { derivePaymentNature, resolveCoveragePlan } from "@/lib/payments/cost-policy";
import { attachStripeSession, createPendingPayment } from "@/lib/payments/pending-payments";
import { getStripeForMode, resolveConnectedAccountForCharges } from "@/lib/payments/stripe-connect";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { postLedgerEntry } from "./ledger";

/**
 * Payment collection against a posted PtaVolunteerAssessmentCharge — mirrors
 * purchases.ts's Stripe Connect pattern exactly, classified
 * "pta-volunteer-assessment" (FIXED_OBLIGATION, never a donation). V1
 * assumes one successful payment settles the charge in full; the
 * amountPaidCents/status columns already support partial payment if a PTA
 * ever needs installments, without a schema change.
 */
export async function createVolunteerAssessmentCheckout(
  organizationId: string,
  chargeId: string,
  householdId: string,
  actor: { userId: string },
  options: { coverProcessingCosts?: boolean } = {}
): Promise<{ url: string }> {
  // householdId is ALWAYS the caller's own (resolved server-side from
  // requireVolunteerHoursHouseholdAccess, never a client parameter) — this
  // is the tenant-isolation check that stops one family from paying (or
  // even discovering the existence of) another family's assessment.
  const charge = await prisma.ptaVolunteerAssessmentCharge.findFirst({ where: { id: chargeId, organizationId, householdId } });
  if (!charge) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment charge not found in this organization.");
  if (charge.status === "PAID") throw new PtaError("PTA_VALIDATION_ERROR", "This assessment has already been paid.");

  const outstandingCents = charge.amountCents - charge.amountPaidCents;
  if (outstandingCents <= 0) throw new PtaError("PTA_VALIDATION_ERROR", "Nothing is currently owed on this assessment.");

  const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(organizationId);
  const stripe = await getStripeForMode(accountMode as "test" | "live");
  const env = getServerEnv();
  const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

  const nature = derivePaymentNature({ purpose: "pta-volunteer-assessment" });
  const plan = await resolveCoveragePlan({
    organizationId,
    nature,
    baseCents: outstandingCents,
    payerOptedIn: options.coverProcessingCosts === true,
  });

  const pending = await createPendingPayment({
    organizationId,
    contributorUserId: actor.userId,
    paymentPurpose: "pta-volunteer-assessment",
    paymentNature: nature,
    obligationCents: outstandingCents,
    processingCostCents: plan.coverageCents,
    coverageMode: plan.coverageMode,
    coverageRequired: plan.required,
    coveragePolicyVersion: plan.policyVersion,
    stripeConnectedAccountId,
  });

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_intent_data: { metadata: { organizationId, paymentType: "pta-volunteer-assessment" } },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Volunteer Hour Assessment",
              description: "Remaining-hours assessment — not a donation or tax-deductible contribution.",
            },
            unit_amount: plan.totalCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/labs/pta/my-pta?volunteerAssessment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/labs/pta/my-pta?volunteerAssessment=cancelled`,
      metadata: {
        product: "Unestra",
        platformOwner: "APH Technologies, LLC",
        paymentType: "pta-volunteer-assessment",
        organizationId,
        stripeConnectedAccountId,
        assessmentChargeId: charge.id,
        pendingPaymentId: pending.id,
        idempotencyReference: pending.idempotencyReference,
        environment: process.env.NODE_ENV ?? "development",
      },
    },
    { stripeAccount: stripeConnectedAccountId }
  );
  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  await Promise.all([
    attachStripeSession(pending.id, session.id),
    prisma.ptaVolunteerAssessmentCharge.update({
      where: { id: charge.id },
      data: { pendingPaymentId: pending.id, providerSessionId: session.id, stripeConnectedAccountId, paymentMethod: "STRIPE" },
    }),
  ]);

  return { url: session.url };
}

export type RecordAssessmentPaymentOutcome = { outcome: "RECORDED" } | { outcome: "ALREADY_RECORDED" } | { outcome: "REJECTED"; reason: string };

export async function recordVolunteerAssessmentPayment(input: {
  organizationId: string;
  chargeId: string;
  amountTotalCents: number;
  stripeConnectedAccountId: string;
  providerPaymentIntentId: string | null;
  providerSessionId: string;
}): Promise<RecordAssessmentPaymentOutcome> {
  const charge = await prisma.ptaVolunteerAssessmentCharge.findFirst({ where: { id: input.chargeId, organizationId: input.organizationId } });
  if (!charge) return { outcome: "REJECTED", reason: "assessment charge not found in this organization" };
  if (charge.status === "PAID") return { outcome: "ALREADY_RECORDED" };

  const outstandingCents = charge.amountCents - charge.amountPaidCents;
  if (outstandingCents !== input.amountTotalCents) {
    return { outcome: "REJECTED", reason: `paid total ${input.amountTotalCents} != outstanding ${outstandingCents}` };
  }
  if (charge.stripeConnectedAccountId !== input.stripeConnectedAccountId) {
    return { outcome: "REJECTED", reason: "connected account mismatch" };
  }

  const updated = await prisma.ptaVolunteerAssessmentCharge.updateMany({
    where: { id: charge.id, status: { in: ["PENDING", "PARTIAL"] } },
    data: {
      status: "PAID",
      amountPaidCents: charge.amountCents,
      paidAt: new Date(),
      providerPaymentIntentId: input.providerPaymentIntentId,
      providerSessionId: input.providerSessionId,
    },
  });
  if (updated.count === 0) {
    const current = await prisma.ptaVolunteerAssessmentCharge.findUnique({ where: { id: charge.id } });
    return current?.status === "PAID" ? { outcome: "ALREADY_RECORDED" } : { outcome: "REJECTED", reason: "lost settle race" };
  }

  await postLedgerEntry({
    organizationId: charge.organizationId,
    requirementPeriodId: charge.requirementPeriodId,
    householdId: charge.householdId,
    entryType: "PAYMENT_ELECTRONIC",
    amountCents: input.amountTotalCents,
    approvalStatus: "APPROVED",
    sourceType: "assessmentChargePayment",
    sourceId: charge.id,
    description: "Volunteer hour assessment payment (Stripe)",
  });

  await createAuditEvent({
    organizationId: charge.organizationId,
    action: "pta.volunteer_hours.assessment_paid",
    entityType: "pta_volunteer_assessment_charge",
    entityId: charge.id,
    metadata: { amountCents: input.amountTotalCents },
  });

  return { outcome: "RECORDED" };
}

export async function recordOfflineVolunteerAssessmentPayment(
  organizationId: string,
  chargeId: string,
  input: { paymentMethod: "CASH" | "CHECK" | "ZELLE" | "CASH_APP" | "OTHER"; reference?: string | null; notes?: string | null },
  actor: { userId: string; userEmail?: string | null }
) {
  const charge = await prisma.ptaVolunteerAssessmentCharge.findFirst({ where: { id: chargeId, organizationId } });
  if (!charge) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment charge not found in this organization.");
  if (charge.status === "PAID") throw new PtaError("PTA_VALIDATION_ERROR", "This assessment has already been paid.");

  const updated = await prisma.ptaVolunteerAssessmentCharge.update({
    where: { id: charge.id },
    data: {
      status: "PAID",
      amountPaidCents: charge.amountCents,
      paidAt: new Date(),
      paymentMethod: input.paymentMethod,
      offlineReference: input.reference?.trim() || null,
      offlineNotes: input.notes?.trim() || null,
      recordedByUserId: actor.userId,
    },
  });

  await postLedgerEntry({
    organizationId,
    requirementPeriodId: charge.requirementPeriodId,
    householdId: charge.householdId,
    entryType: "PAYMENT_OFFLINE",
    amountCents: charge.amountCents,
    approvalStatus: "APPROVED",
    sourceType: "assessmentChargePayment",
    sourceId: charge.id,
    description: `Offline payment (${input.paymentMethod}) recorded by administrator`,
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.assessment_offline_payment_recorded",
    entityType: "pta_volunteer_assessment_charge",
    entityId: charge.id,
    metadata: { paymentMethod: input.paymentMethod, amountCents: charge.amountCents },
  });

  return updated;
}
