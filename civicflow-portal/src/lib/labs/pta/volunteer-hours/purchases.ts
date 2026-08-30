import { Prisma, type PtaVolunteerElectionType, type PtaVolunteerPurchasePaymentMethod } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { getServerEnv } from "@/lib/env";
import { derivePaymentNature, resolveCoveragePlan } from "@/lib/payments/cost-policy";
import { attachStripeSession, createPendingPayment } from "@/lib/payments/pending-payments";
import { getStripeForMode, resolveConnectedAccountForCharges } from "@/lib/payments/stripe-connect";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { resolveLockedOrFreshQuote } from "./elections";
import { postLedgerEntry } from "./ledger";

/**
 * fix/pta-volunteer-financial-controls, FC-5: closes the double-completion
 * risk the pricing-lock design note (§6) flagged — two independently
 * PENDING purchases for the same household+period could each pass the
 * webhook's own idempotency check (which only dedupes retries of the SAME
 * purchase row) and both post a ledger credit. Rather than restricting how
 * many hours are purchasable (which would also block a legitimate retry
 * after an abandoned or failed checkout — see the design note's dedicated
 * "abandoned/retried checkout" discussion), every NEW purchase attempt
 * (Stripe checkout creation, or an offline payment being recorded) first
 * supersedes any other still-PENDING purchase for the same household and
 * period. At most one purchase can ever be PENDING at a time, so an old
 * abandoned Stripe session can never be completed after a later attempt
 * has already succeeded — its purchase row is FAILED, so
 * `recordVolunteerBuyoutPurchase`'s own `status: "PENDING"` compare-and-set
 * finds nothing to update and correctly rejects the late webhook. The
 * `updateMany` filter re-checks `status: "PENDING"` at write time, so a
 * purchase that completes via its own webhook in the gap between this read
 * and write is never clobbered.
 */
async function supersedePendingPurchases(organizationId: string, periodId: string, householdId: string, actor: { userId: string; userEmail?: string | null }) {
  const pending = await prisma.ptaVolunteerBuyoutPurchase.findMany({
    where: { organizationId, requirementPeriodId: periodId, householdId, status: "PENDING" },
    select: { id: true },
  });
  if (pending.length === 0) return;

  const ids = pending.map((p) => p.id);
  const { count } = await prisma.ptaVolunteerBuyoutPurchase.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "FAILED" },
  });
  if (count === 0) return;

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.pending_purchase_superseded",
    entityType: "pta_volunteer_buyout_purchase",
    entityId: ids[0],
    metadata: { supersededPurchaseIds: ids, householdId, periodId },
  });
}

/**
 * RV-2: true for a lost race against
 * PtaVolunteerBuyoutPurchase_org_period_household_pending — "at most one
 * PENDING purchase per (organizationId, requirementPeriodId, householdId)"
 * (see the schema-drift warning on that model). Mirrors
 * assessments.ts's isDuplicateChargeConstraintViolation exactly, including
 * the two-shape target handling (a schema-declared constraint reports its
 * target as a column-name array; an index Prisma has no @@unique/@@index
 * representation for may instead report the raw index name as a string) —
 * see that function's comment for the full explanation. This function is
 * only ever called on an error thrown by `ptaVolunteerBuyoutPurchase.create`,
 * so reusing the same column-name pair as assessments.ts's check (both
 * partial indexes share these two column names, on different tables) is
 * unambiguous in practice.
 */
function isDuplicatePendingPurchaseConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes("householdId") && target.includes("requirementPeriodId");
  if (typeof target === "string") return target.includes("org_period_household_pending");
  return false;
}

/**
 * RV-2: the authoritative liveness check for an existing PENDING purchase's
 * Stripe Checkout Session. A session's own `status` ("open" | "complete" |
 * "expired") is Stripe's ground truth — this deliberately does NOT guess at
 * a locally-derived time window (Stripe's default 24h expiry, or a shorter
 * one an admin configured on the account), since that would drift from
 * reality. Returns null (never throws) for: no session yet (the purchase
 * row exists but hasn't reached Stripe — e.g. a crash between
 * `purchase.create` and `session.create`), not found, expired, or complete
 * (already paid — the webhook, not a fresh checkout call, is what handles
 * that). Every null case falls through to the caller's normal
 * supersede-then-create path, so a genuinely abandoned or already-settled
 * purchase never blocks a legitimate new attempt.
 */
async function reuseOpenCheckoutSessionUrl(
  stripe: Awaited<ReturnType<typeof getStripeForMode>>,
  stripeConnectedAccountId: string,
  providerSessionId: string | null
): Promise<string | null> {
  if (!providerSessionId) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(providerSessionId, {}, { stripeAccount: stripeConnectedAccountId });
    return session.status === "open" && session.url ? session.url : null;
  } catch {
    return null;
  }
}

/**
 * Reuses Unestra's existing Stripe Connect + COST-POLICY v2 checkout
 * infrastructure exactly as giving does (src/app/api/giving/checkout/route.ts)
 * — no parallel payment plumbing. Never trusts a client-supplied price.
 * The quote is resolved via `resolveLockedOrFreshQuote`
 * (docs/pta-volunteer-hours-pricing-lock-design.md, FC-4): a window
 * configured `lockTiming=ELECTION` honors the linked election's frozen
 * price; every other case re-resolves fresh at this exact moment, which is
 * where a `lockTiming=CHECKOUT` window's rate is genuinely locked — Stripe
 * Checkout Sessions require a fixed unit_amount at creation, and that
 * amount is then frozen through webhook fulfillment (recordVolunteerBuyoutPurchase
 * never reprices). Classified "pta-volunteer-buyout" — never a
 * donation/tax-deductible contribution (spec §17).
 *
 * RV-2: database-backed idempotency, not just the check-then-act supersede
 * pass. Before creating anything, a still-open PENDING purchase for this
 * household+period is reused (same URL returned) rather than superseded —
 * this is what makes a page reload or a second click of "Buy out hours"
 * return the family to the SAME Stripe session instead of quietly
 * cancelling it out from under them (the exact "request A supersedes
 * request B after B has already advanced toward payment" gap flagged in
 * review). Only when no PENDING purchase exists, or the existing one's
 * session is gone/expired/complete, does the code fall through to
 * `supersedePendingPurchases` + a fresh `create`. The `create` itself is
 * wrapped for the partial unique index's P2002: two truly simultaneous
 * callers can both pass the reuse-check (nothing existed yet) and both
 * reach `create`, but the database allows only one PENDING row to exist, so
 * the loser catches the violation and reuses the winner's session instead
 * of erroring or duplicating — see `isDuplicatePendingPurchaseConstraintViolation`
 * and the model's schema-drift warning in schema.prisma. A deterministic,
 * per-purchase-row Stripe `idempotencyKey` additionally protects the
 * `session.create` call itself against being retried into two sessions if
 * this function's own network call to Stripe is retried after an
 * ambiguous/lost response — a different, narrower guarantee than the DB
 * constraint (which is what actually prevents two DIFFERENT purchase rows
 * from both reaching Stripe in the first place).
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

  const quote = await resolveLockedOrFreshQuote(organizationId, periodId, householdId, input);
  if (quote.totalCents <= 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This purchase has no cost to check out.");
  }

  const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(organizationId);
  const stripe = await getStripeForMode(accountMode as "test" | "live");

  const existingPending = await prisma.ptaVolunteerBuyoutPurchase.findFirst({
    where: { organizationId, requirementPeriodId: periodId, householdId, status: "PENDING" },
  });
  if (existingPending) {
    const reusedUrl = await reuseOpenCheckoutSessionUrl(stripe, stripeConnectedAccountId, existingPending.providerSessionId);
    if (reusedUrl) return { url: reusedUrl };
  }

  await supersedePendingPurchases(organizationId, periodId, householdId, actor);

  const env = getServerEnv();
  const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

  const nature = derivePaymentNature({ purpose: "pta-volunteer-buyout" });
  const plan = await resolveCoveragePlan({
    organizationId,
    nature,
    baseCents: quote.totalCents,
    payerOptedIn: input.coverProcessingCosts === true,
  });

  let purchase;
  try {
    purchase = await prisma.ptaVolunteerBuyoutPurchase.create({
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
  } catch (error) {
    if (!isDuplicatePendingPurchaseConstraintViolation(error)) throw error;
    // Lost a genuine concurrent race — some other request's insert won.
    // Never create a second purchase row or a second Stripe session for the
    // same obligation: reuse the winner's session if it has already reached
    // Stripe, otherwise ask this caller to retry rather than silently
    // duplicating or silently superseding a request that may be
    // milliseconds from completing its own checkout.
    const winner = await prisma.ptaVolunteerBuyoutPurchase.findFirst({
      where: { organizationId, requirementPeriodId: periodId, householdId, status: "PENDING" },
    });
    const reusedUrl = winner ? await reuseOpenCheckoutSessionUrl(stripe, stripeConnectedAccountId, winner.providerSessionId) : null;
    if (reusedUrl) return { url: reusedUrl };
    throw new PtaError(
      "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS",
      "Another checkout for this household is already being prepared. Please try again in a moment."
    );
  }

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
    // RV-2: a deterministic, per-purchase-row idempotency key — protects
    // this specific `session.create` call against being retried into two
    // sessions if the network call itself is retried after an
    // ambiguous/lost response. This is narrower than, and independent of,
    // the DB constraint above: the constraint is what stops two DIFFERENT
    // purchase rows from both reaching this line for the same obligation.
    { stripeAccount: stripeConnectedAccountId, idempotencyKey: `pta-volunteer-buyout-checkout:${purchase.id}` }
  );
  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  // Deployment-gate review: this was previously an unconditional `update`.
  // While THIS call was awaiting Stripe (a real network round-trip), another
  // concurrent caller can legitimately observe this row with
  // `providerSessionId` still null, conclude (correctly, at that instant)
  // that there is no live session to reuse, and supersede it via
  // `supersedePendingPurchases` -- flipping it to FAILED. An unconditional
  // `update` here would then silently re-attach a real, live Stripe session
  // URL to that now-FAILED row and hand it back to this caller: if the
  // family paid through it, the webhook's `status: "PENDING"`
  // compare-and-swap in `recordVolunteerBuyoutPurchase` would match zero
  // rows and silently drop the payment -- Stripe collects real money, no
  // charge/ledger credit is ever posted. The `updateMany` below closes that
  // gap the same way every other write in this module is already
  // guarded: attach only succeeds if the row is still the one PENDING row;
  // if it lost that race, the caller is asked to retry (which routes it to
  // whatever purchase row IS currently live) instead of ever being handed a
  // URL for a row nothing will honor. The abandoned Stripe session itself
  // is harmless -- nothing will ever direct anyone to pay it, and it
  // expires on Stripe's own schedule like any other uncompleted session.
  const attached = await prisma.ptaVolunteerBuyoutPurchase.updateMany({
    where: { id: purchase.id, status: "PENDING" },
    data: { pendingPaymentId: pending.id, providerSessionId: session.id },
  });
  if (attached.count === 0) {
    throw new PtaError(
      "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS",
      "Another checkout for this household is already being prepared. Please try again in a moment."
    );
  }
  await attachStripeSession(pending.id, session.id);

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
 * confirmed-payment requirement. Uses the same lock-timing dispatch as
 * Stripe checkout (`resolveLockedOrFreshQuote`) so a family who elected
 * under an ELECTION-locked window and later pays by check gets the same
 * frozen price they would have gotten through Stripe — there is no reason
 * the payment rail should change which price applies. Falls back to a
 * fresh quote when there's no election or the window is CHECKOUT-locked.
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
  const quote = await resolveLockedOrFreshQuote(organizationId, periodId, householdId, input);

  await supersedePendingPurchases(organizationId, periodId, householdId, actor);

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
