import type { PtaVolunteerElectionType, PtaVolunteerPurchasePaymentMethod } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { getServerEnv } from "@/lib/env";
import { derivePaymentNature, resolveCoveragePlan } from "@/lib/payments/cost-policy";
import { attachStripeSession, createPendingPayment } from "@/lib/payments/pending-payments";
import { getStripeForMode, resolveConnectedAccountForCharges } from "@/lib/payments/stripe-connect";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { buildBuyoutQuote } from "./elections";
import { postLedgerEntry } from "./ledger";

/**
 * Reuses Unestra's existing Stripe Connect + COST-POLICY v2 checkout
 * infrastructure exactly as giving does (src/app/api/giving/checkout/route.ts)
 * — no parallel payment plumbing. The quote is ALWAYS re-resolved fresh here
 * (never trusts a client-supplied price or a stale election snapshot),
 * since Stripe Checkout Sessions require a fixed unit_amount at creation —
 * this is the point where the rate is genuinely locked, matching
 * lockTiming=CHECKOUT_START. Classified "pta-volunteer-buyout" — never a
 * donation/tax-deductible contribution (spec §17).
 */
export async function createVolunteerBuyoutCheckout(
  organizationId: string,
  periodId: string,
  householdId: string,
  input: { electionId?: string | null; electionType: PtaVolunteerElectionType; hoursElectedMinutes?: number; coverProcessingCosts?: boolean },
  actor: { userId: string }
): Promise<{ url: string }> {
  if (input.electionType !== "FULL_BUYOUT" && input.electionType !== "PARTIAL_BUYOUT") {
    throw new PtaError("PTA_VALIDATION_ERROR", "Only a buyout election can be checked out — nothing to pay for a volunteer-only election.");
  }

  const quote = await buildBuyoutQuote(organizationId, periodId, householdId, input);
  if (quote.totalCents <= 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This purchase has no cost to check out.");
  }

  const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(organizationId);
  const stripe = await getStripeForMode(accountMode as "test" | "live");
  const env = getServerEnv();
  const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

  const nature = derivePaymentNature({ purpose: "pta-volunteer-buyout" });
  const plan = await resolveCoveragePlan({
    organizationId,
    nature,
    baseCents: quote.totalCents,
    payerOptedIn: input.coverProcessingCosts === true,
  });

  const purchase = await prisma.ptaVolunteerBuyoutPurchase.create({
    data: {
      organizationId,
      electionId: input.electionId ?? null,
      requirementPeriodId: periodId,
      householdId,
      electionType: quote.electionType,
      hoursElectedMinutes: quote.hoursElectedMinutes,
      rateType: quote.electionType === "FULL_BUYOUT" ? "FULL_BUYOUT" : "PER_HOUR",
      rateCents: quote.rateCents,
      baseAmountCents: quote.totalCents,
      coverageAmountCents: plan.coverageCents,
      totalCents: plan.totalCents,
      pricingWindowId: quote.pricingWindowId,
      status: "PENDING",
      paymentMethod: "STRIPE",
      stripeConnectedAccountId,
    },
  });

  const pending = await createPendingPayment({
    organizationId,
    contributorUserId: actor.userId,
    paymentPurpose: "pta-volunteer-buyout",
    paymentNature: nature,
    obligationCents: quote.totalCents,
    processingCostCents: plan.coverageCents,
    coverageMode: plan.coverageMode,
    coverageRequired: plan.required,
    coveragePolicyVersion: plan.policyVersion,
    stripeConnectedAccountId,
  });

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_intent_data: { metadata: { organizationId, paymentType: "pta-volunteer-buyout" } },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: quote.electionType === "FULL_BUYOUT" ? "Volunteer Hour Buyout (full)" : "Volunteer Hour Buyout",
              description: "Volunteer Hour Buyout — not a donation or tax-deductible contribution.",
            },
            unit_amount: plan.totalCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/labs/pta/my-pta?volunteerCheckout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/labs/pta/my-pta?volunteerCheckout=cancelled`,
      metadata: {
        product: "Unestra",
        platformOwner: "APH Technologies, LLC",
        paymentType: "pta-volunteer-buyout",
        organizationId,
        stripeConnectedAccountId,
        buyoutPurchaseId: purchase.id,
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
    prisma.ptaVolunteerBuyoutPurchase.update({ where: { id: purchase.id }, data: { pendingPaymentId: pending.id, providerSessionId: session.id } }),
  ]);

  return { url: session.url };
}

export type RecordPurchaseOutcome = { outcome: "RECORDED" } | { outcome: "ALREADY_RECORDED" } | { outcome: "REJECTED"; reason: string };

/**
 * Called from the Stripe Connect webhook after the generic PendingPayment
 * settle step. Never re-quotes — validates the ALREADY-SNAPSHOTTED purchase
 * row against what Stripe actually charged, and records nothing on any
 * mismatch (same rigor as giving's coverage-split cross-check). Idempotent
 * via a compare-and-swap status transition, mirroring
 * settlePendingPaymentBySession's own pattern.
 */
export async function recordVolunteerBuyoutPurchase(input: {
  organizationId: string;
  purchaseId: string;
  amountTotalCents: number;
  stripeConnectedAccountId: string;
  providerPaymentIntentId: string | null;
  providerSessionId: string;
}): Promise<RecordPurchaseOutcome> {
  const purchase = await prisma.ptaVolunteerBuyoutPurchase.findFirst({ where: { id: input.purchaseId, organizationId: input.organizationId } });
  if (!purchase) return { outcome: "REJECTED", reason: "purchase not found in this organization" };
  if (purchase.status === "COMPLETED") return { outcome: "ALREADY_RECORDED" };
  if (purchase.totalCents !== input.amountTotalCents) {
    return { outcome: "REJECTED", reason: `paid total ${input.amountTotalCents} != authorized total ${purchase.totalCents}` };
  }
  if (purchase.stripeConnectedAccountId !== input.stripeConnectedAccountId) {
    return { outcome: "REJECTED", reason: "connected account mismatch" };
  }

  const updated = await prisma.ptaVolunteerBuyoutPurchase.updateMany({
    where: { id: purchase.id, status: "PENDING" },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      providerPaymentIntentId: input.providerPaymentIntentId,
      providerSessionId: input.providerSessionId,
    },
  });
  if (updated.count === 0) {
    const current = await prisma.ptaVolunteerBuyoutPurchase.findUnique({ where: { id: purchase.id } });
    return current?.status === "COMPLETED" ? { outcome: "ALREADY_RECORDED" } : { outcome: "REJECTED", reason: "lost settle race" };
  }

  await postLedgerEntry({
    organizationId: purchase.organizationId,
    requirementPeriodId: purchase.requirementPeriodId,
    householdId: purchase.householdId,
    entryType: "PURCHASE",
    minutes: purchase.hoursElectedMinutes,
    amountCents: purchase.baseAmountCents,
    approvalStatus: "APPROVED",
    sourceType: "buyoutPurchase",
    sourceId: purchase.id,
    description: `${purchase.electionType === "FULL_BUYOUT" ? "Full" : "Partial"} volunteer hour buyout`,
  });
  await postLedgerEntry({
    organizationId: purchase.organizationId,
    requirementPeriodId: purchase.requirementPeriodId,
    householdId: purchase.householdId,
    entryType: "PAYMENT_ELECTRONIC",
    amountCents: purchase.totalCents,
    approvalStatus: "APPROVED",
    sourceType: "buyoutPurchasePayment",
    sourceId: purchase.id,
    description: "Volunteer hour buyout payment (Stripe)",
  });

  await createAuditEvent({
    organizationId: purchase.organizationId,
    action: "pta.volunteer_hours.purchase_completed",
    entityType: "pta_volunteer_buyout_purchase",
    entityId: purchase.id,
    metadata: { hoursElectedMinutes: purchase.hoursElectedMinutes, totalCents: purchase.totalCents },
  });

  return { outcome: "RECORDED" };
}

export interface RecordOfflinePurchaseInput {
  electionId?: string | null;
  electionType: PtaVolunteerElectionType;
  hoursElectedMinutes?: number;
  paymentMethod: Exclude<PtaVolunteerPurchasePaymentMethod, "STRIPE">;
  reference?: string | null;
  notes?: string | null;
}

/**
 * Admin-recorded offline payment (cash/check/Zelle/CashApp/other) — spec
 * §7/§17. Purchased-hour credit posts only once an authorized administrator
 * records and verifies the payment, exactly like the Stripe path's
 * confirmed-payment requirement. Re-quotes fresh (there's no prior
 * "checkout" moment for an offline payment to lock at).
 */
export async function recordOfflineVolunteerBuyoutPurchase(
  organizationId: string,
  periodId: string,
  householdId: string,
  input: RecordOfflinePurchaseInput,
  actor: { userId: string; userEmail?: string | null }
) {
  if (input.electionType !== "FULL_BUYOUT" && input.electionType !== "PARTIAL_BUYOUT") {
    throw new PtaError("PTA_VALIDATION_ERROR", "Only a buyout election can be recorded as a purchase.");
  }
  const quote = await buildBuyoutQuote(organizationId, periodId, householdId, input);

  const purchase = await prisma.ptaVolunteerBuyoutPurchase.create({
    data: {
      organizationId,
      electionId: input.electionId ?? null,
      requirementPeriodId: periodId,
      householdId,
      electionType: quote.electionType,
      hoursElectedMinutes: quote.hoursElectedMinutes,
      rateType: quote.electionType === "FULL_BUYOUT" ? "FULL_BUYOUT" : "PER_HOUR",
      rateCents: quote.rateCents,
      baseAmountCents: quote.totalCents,
      coverageAmountCents: 0,
      totalCents: quote.totalCents,
      pricingWindowId: quote.pricingWindowId,
      status: "COMPLETED",
      paymentMethod: input.paymentMethod,
      offlineReference: input.reference?.trim() || null,
      offlineNotes: input.notes?.trim() || null,
      recordedByUserId: actor.userId,
      completedAt: new Date(),
    },
  });

  await postLedgerEntry({
    organizationId,
    requirementPeriodId: periodId,
    householdId,
    entryType: "PURCHASE",
    minutes: purchase.hoursElectedMinutes,
    amountCents: purchase.baseAmountCents,
    approvalStatus: "APPROVED",
    sourceType: "buyoutPurchase",
    sourceId: purchase.id,
    description: `${purchase.electionType === "FULL_BUYOUT" ? "Full" : "Partial"} volunteer hour buyout (offline)`,
  });
  await postLedgerEntry({
    organizationId,
    requirementPeriodId: periodId,
    householdId,
    entryType: "PAYMENT_OFFLINE",
    amountCents: purchase.totalCents,
    approvalStatus: "APPROVED",
    sourceType: "buyoutPurchasePayment",
    sourceId: purchase.id,
    description: `Offline payment (${input.paymentMethod}) recorded by administrator`,
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.offline_purchase_recorded",
    entityType: "pta_volunteer_buyout_purchase",
    entityId: purchase.id,
    metadata: { paymentMethod: input.paymentMethod, totalCents: purchase.totalCents, hoursElectedMinutes: purchase.hoursElectedMinutes },
  });

  return purchase;
}
