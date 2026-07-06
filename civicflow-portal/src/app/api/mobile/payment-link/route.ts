import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { findActivePaymentLink } from "@/lib/payment-links";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/payment-link?organizationId=...&campaignId=...|eventId=...|dues=true
 * Looks up the org's active (non-expired) Stripe payment link for a
 * campaign, event, or org-wide dues-in-advance, for the mobile app's Make a
 * Payment "Pay Now via Card" button. Returns { slug: null } if none is set
 * up yet — the manual payment methods are always the fallback.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    const campaignId = searchParams.get("campaignId") ?? undefined;
    const eventId = searchParams.get("eventId") ?? undefined;
    const dues = searchParams.get("dues") === "true";
    if (!organizationId) throw new ValidationError("organizationId is required");
    if (!campaignId && !eventId && !dues) {
      throw new ValidationError("One of campaignId, eventId, or dues=true is required");
    }

    const { organizationId: verifiedOrgId } = await requireMobileMembership(request, organizationId);

    const link = await findActivePaymentLink({
      organizationId: verifiedOrgId,
      campaignId,
      eventId,
      linkType: dues ? "DUES" : undefined,
    });

    return Response.json({ ok: true, data: { slug: link?.slug ?? null } });
  });
}
