import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { resolveConnectedAccountForCharges, getStripeForMode } from "@/lib/payments/stripe-connect";
import { derivePaymentNature, resolveCoveragePlan } from "@/lib/payments/cost-policy";
import { attachStripeSession, createPendingPayment } from "@/lib/payments/pending-payments";
import { getServerEnv } from "@/lib/env";
import { resolveOrganizationAccess, PUBLIC_UNAVAILABLE_MESSAGE } from "@/lib/subscription-gate";

const checkoutSchema = z.object({
  amount: z.number().positive().optional(),
  contributorName: z.string().trim().max(160).optional(),
  contributorEmail: z.string().email().optional(),
  /** FEE-COVER-C: opt-in only — a boolean request, never an amount. The
   * server quotes the actual coverage from the org's own configured rate
   * and ignores this entirely unless the org's mode offers coverage. */
  coverProcessingCosts: z.boolean().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:pay:checkout",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { slug } = await params;
    const input = await parseJsonBody(request, checkoutSchema);

    const link = await prisma.paymentLink.findUnique({
      where: { slug },
      include: {
        organization: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
      },
    });

    if (!link || link.status !== "active") {
      return Response.json({ ok: false, error: "Payment link not found or inactive" }, { status: 404 });
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      return Response.json({ ok: false, error: "This payment link has expired" }, { status: 410 });
    }

    // LAUNCH-BLOCKER subscription gate: a billing-inactive organization
    // must not keep accepting money through the platform, even though this
    // money is collected via the org's OWN connected Stripe account (never
    // Unestra Cloud SaaS billing). Deliberately a neutral message — an
    // anonymous payer must never learn the organization's own billing state.
    const access = await resolveOrganizationAccess(link.organization.id);
    if (!access.allowed) {
      return Response.json({ ok: false, error: PUBLIC_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const stripeMethod = await prisma.paymentLinkMethod.findFirst({
      where: {
        paymentLinkId: link.id,
        paymentMethodConfig: { method: "STRIPE", isActive: true },
      },
    });
    if (!stripeMethod) {
      throw new ValidationError("This payment link doesn't offer online card payment.");
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

    // CONNECT-E (§10/§55): resolved SERVER-SIDE from the organization — a
    // clean 409 ("Payments are not set up...") when not connected, never a
    // fallback to the platform account. Manual/offline payment methods on
    // this same link (see PaymentMethodConfig) are unaffected — this route
    // only ever runs for the STRIPE method, already gated above.
    const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(link.organizationId);
    const stripe = await getStripeForMode(accountMode as "test" | "live");
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

    const destination =
      link.campaign?.name ?? link.event?.title ?? link.organization.name;

    // COST-POLICY v2 (§2): the link's own configuration determines nature —
    // campaign links are voluntary; event-registration links are fixed
    // purchases; dues-in-advance links are fixed obligations. With v2
    // disabled for the org, resolveCoveragePlan reproduces FEE-COVER-C's
    // optional opt-in exactly (quoted server-side at the org's CURRENT
    // rate, snapshotted below — the webhook records exactly this split).
    const purpose = link.campaign?.name
      ? ("payment-link-campaign" as const)
      : link.event?.title
        ? ("payment-link-event" as const)
        : ("payment-link-dues" as const);
    const nature = derivePaymentNature({ purpose });
    const plan = await resolveCoveragePlan({
      organizationId: link.organizationId,
      nature,
      baseCents: amountCents,
      payerOptedIn: input.coverProcessingCosts === true,
    });
    const coverageCents = plan.coverageCents;

    // §7: Unestra's first-party pending record, persisted BEFORE redirect.
    const pending = await createPendingPayment({
      organizationId: link.organizationId,
      paymentPurpose: purpose,
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
              product_data: {
                name: link.title,
                description: destination,
              },
              unit_amount: plan.totalCents,
            },
            quantity: 1,
          },
        ],
        ...(input.contributorEmail ? { customer_email: input.contributorEmail } : {}),
        success_url: `${baseUrl}/pay/${slug}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/pay/${slug}`,
        metadata: {
          product: "Unestra",
          platformOwner: "APH Technologies, LLC",
          paymentType: link.campaign?.name ? "campaign" : link.event?.title ? "event" : "dues",
          paymentLinkId: link.id,
          organizationId: link.organizationId,
          campaignId: link.campaignId ?? "",
          eventId: link.eventId ?? "",
          contributorName: input.contributorName ?? "",
          stripeConnectedAccountId,
          // FEE-COVER-C: base/coverage split snapshotted at checkout time,
          // validated by resolveCoverageSplit in the connect webhook.
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
