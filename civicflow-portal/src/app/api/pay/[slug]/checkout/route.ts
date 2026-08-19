import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { resolveConnectedAccountForCharges, getStripeForMode } from "@/lib/payments/stripe-connect";
import { quoteProcessingCostCoverage } from "@/lib/giving/processing-cost-coverage";
import { getServerEnv } from "@/lib/env";

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

    // FEE-COVER-C: quoted server-side at the org's CURRENT rate and
    // snapshotted into metadata — the webhook records exactly this split,
    // never a recomputation (same discipline as giving/CONNECT-F §36).
    const { coverageCents } = input.coverProcessingCosts
      ? await quoteProcessingCostCoverage(link.organizationId, amountCents)
      : { coverageCents: 0 };

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: link.title,
                description: destination,
              },
              unit_amount: amountCents + coverageCents,
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
          environment: process.env.NODE_ENV ?? "development",
        },
      },
      { stripeAccount: stripeConnectedAccountId }
    );

    if (!session.url) throw new Error("Stripe did not return a checkout URL");

    return Response.json({ ok: true, url: session.url });
  });
}
