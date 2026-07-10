import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { getStripe } from "@/lib/stripe";
import { getServerEnv } from "@/lib/env";

const checkoutSchema = z.object({
  amount: z.number().positive().optional(),
  contributorName: z.string().trim().max(160).optional(),
  contributorEmail: z.string().email().optional(),
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

    const stripe = getStripe();
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

    const destination =
      link.campaign?.name ?? link.event?.title ?? link.organization.name;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: link.title,
              description: destination,
            },
            unit_amount: amountCents,
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
        environment: process.env.NODE_ENV ?? "development",
      },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL");

    return Response.json({ ok: true, url: session.url });
  });
}
