import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { createPaymentLinkOfflineReportAndNotify } from "@/lib/payment-link-offline-reports";
import { getPaymentMethodCategory } from "@/lib/payment-method-links";
import { resolveOrganizationAccess, PUBLIC_UNAVAILABLE_MESSAGE } from "@/lib/subscription-gate";

const offlineReportSchema = z.object({
  paymentMethodConfigId: z.string().min(1),
  payerName: z.string().trim().min(1).max(160),
  payerEmail: z.string().trim().email(),
  amount: z.number().positive(),
  referenceNumber: z.string().trim().max(160).optional(),
  message: z.string().trim().max(2000).optional(),
});

/**
 * Public (anonymous) submission of "I've made this payment" for an offline
 * payment method on a Payment Link -- creates a pending
 * PaymentLinkOfflineReport for officer review. Never marks a payment as
 * verified/paid; see docs/flexible-payment-links.md.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:pay:offline-report",
      request,
      limit: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { slug } = await params;
    const input = await parseJsonBody(request, offlineReportSchema);

    const link = await prisma.paymentLink.findUnique({ where: { slug } });
    if (!link || link.status !== "active") {
      return Response.json({ ok: false, error: "Payment link not found or inactive" }, { status: 404 });
    }
    if (link.expiresAt && link.expiresAt < new Date()) {
      return Response.json({ ok: false, error: "This payment link has expired" }, { status: 410 });
    }

    // LAUNCH-BLOCKER subscription gate — see checkout/route.ts's identical check.
    const access = await resolveOrganizationAccess(link.organizationId);
    if (!access.allowed) {
      return Response.json({ ok: false, error: PUBLIC_UNAVAILABLE_MESSAGE }, { status: 503 });
    }

    const minCents = link.minAmount
      ? Math.round(Number(link.minAmount) * 100)
      : link.amount
        ? Math.round(Number(link.amount) * 100)
        : 100;
    if (Math.round(input.amount * 100) < minCents) {
      throw new ValidationError(`Minimum payment is $${(minCents / 100).toFixed(2)}.`);
    }

    // The selected method must genuinely be one this specific link offers
    // (not just any method the org has ever configured), and must be an
    // "offline instructions" category method -- Stripe/external-redirect
    // methods never go through this reporting path.
    const linkMethod = await prisma.paymentLinkMethod.findFirst({
      where: { paymentLinkId: link.id, paymentMethodConfigId: input.paymentMethodConfigId },
      include: { paymentMethodConfig: true },
    });
    if (!linkMethod || !linkMethod.paymentMethodConfig.isActive) {
      return Response.json({ ok: false, error: "This payment method isn't available on this link." }, { status: 400 });
    }
    if (getPaymentMethodCategory(linkMethod.paymentMethodConfig.method) !== "offline") {
      throw new ValidationError("This payment method doesn't accept offline payment reports.");
    }

    const report = await createPaymentLinkOfflineReportAndNotify({
      organizationId: link.organizationId,
      paymentLinkId: link.id,
      paymentMethodConfigId: input.paymentMethodConfigId,
      payerName: input.payerName,
      payerEmail: input.payerEmail,
      amount: input.amount,
      referenceNumber: input.referenceNumber,
      message: input.message,
    });

    return Response.json({ ok: true, data: { id: report.id } });
  });
}
