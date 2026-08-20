import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { findActivePaymentLink } from "@/lib/payment-links";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { resolveConnectedAccountForCharges, getStripeForMode } from "@/lib/payments/stripe-connect";
import { derivePaymentNature, resolveCoveragePlan } from "@/lib/payments/cost-policy";
import { attachStripeSession, createPendingPayment } from "@/lib/payments/pending-payments";
import { getServerEnv } from "@/lib/env";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  amount: z.number().positive().optional(),
  /** FEE-COVER-C: opt-in only — a boolean request, never an amount. The
   * coverage never inflates the dues obligation itself: the webhook settles
   * the member's DuesCharge by the BASE amount only. */
  coverProcessingCosts: z.boolean().optional(),
});

/**
 * Authenticated dues-checkout entry point for /m/make-payment/dues. Unlike
 * the public /pay/[slug] flow (anonymous campaign/event contributions,
 * correctly recorded as Contributions), a member paying dues by card needs
 * the payment applied to their own dues balance. memberId is stamped into
 * the Stripe session metadata here, server-side, from the caller's own
 * authenticated member session — never trusted from client input — so the
 * webhook (checkout.session.completed in /api/webhooks/stripe) can apply the
 * completed payment to this member's oldest outstanding DuesCharge instead
 * of recording an unattributed Contribution that never reduces what they owe.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:member-portal:dues-checkout",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, memberId } = await requireMemberWebSession(input.organizationId);

    const link = await findActivePaymentLink({ organizationId, linkType: "DUES" });
    if (!link) {
      return Response.json({ ok: false, error: "No dues payment link is configured for this organization." }, { status: 404 });
    }

    const amountCents = link.amount
      ? Math.round(Number(link.amount) * 100)
      : input.amount
        ? Math.round(input.amount * 100)
        : null;
    if (!amountCents) throw new ValidationError("An amount is required.");

    const minCents = link.minAmount ? Math.round(Number(link.minAmount) * 100) : 100;
    if (amountCents < minCents) {
      throw new ValidationError(`Minimum payment is $${(minCents / 100).toFixed(2)}.`);
    }

    const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(organizationId);
    const stripe = await getStripeForMode(accountMode as "test" | "live");
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");
    const orgSuffix = `?org=${encodeURIComponent(organizationId)}`;

    // COST-POLICY v2: dues are a FIXED OBLIGATION (§2) — the amount the
    // member pays here settles their DuesCharge by BASE PRINCIPAL, so
    // whatever the coverage plan resolves to, a $10 payment credits $10.
    // With v2 disabled for the org, this reproduces FEE-COVER-C's optional
    // opt-in exactly (quoted server-side, snapshotted into metadata).
    const nature = derivePaymentNature({ purpose: "member-dues" });
    const plan = await resolveCoveragePlan({
      organizationId,
      nature,
      baseCents: amountCents,
      payerOptedIn: input.coverProcessingCosts === true,
    });
    const coverageCents = plan.coverageCents;

    // §7: first-party pending record persisted BEFORE redirect.
    const pending = await createPendingPayment({
      organizationId,
      memberId,
      paymentPurpose: "member-dues",
      paymentNature: nature,
      paymentLinkId: link.id,
      obligationCents: amountCents,
      processingCostCents: coverageCents,
      coverageMode: plan.coverageMode,
      coverageRequired: plan.required,
      coveragePolicyVersion: plan.policyVersion,
      stripeConnectedAccountId,
    });

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        ...(plan.restrictToPaymentMethods ? { payment_method_types: plan.restrictToPaymentMethods as never } : {}),
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: link.title, description: "Membership dues" },
              unit_amount: plan.totalCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/m/dues${orgSuffix}`,
        cancel_url: `${baseUrl}/m/make-payment/dues${orgSuffix}`,
        metadata: {
          product: "Unestra",
          platformOwner: "APH Technologies, LLC",
          paymentType: "dues",
          paymentLinkId: link.id,
          organizationId,
          memberId,
          stripeConnectedAccountId,
          linkBaseAmountCents: String(amountCents),
          linkCoverageAmountCents: String(coverageCents),
          // COST-POLICY v2 (§7) — cross-check only; the PendingPayment row
          // is the accounting record.
          paymentNature: nature,
          obligationAmount: String(amountCents),
          processingCostAmount: String(coverageCents),
          coverageMode: plan.coverageMode,
          coverageRequired: plan.required ? "true" : "false",
          coveragePolicyVersion: plan.policyVersion ?? "",
          allocationVersion: "1",
          idempotencyReference: pending.idempotencyReference,
          pendingPaymentId: pending.id,
          environment: process.env.NODE_ENV ?? "development",
        },
      },
      { stripeAccount: stripeConnectedAccountId }
    );

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    await attachStripeSession(pending.id, session.id);

    return Response.json({ ok: true, url: session.url });
  });
}
