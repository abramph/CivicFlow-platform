import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { createPendingSchedule } from "@/lib/giving/recurring";
import { getOrCreateConnectedGivingCustomer, getOrCreateConnectedGivingProduct, stripeIntervalFor } from "@/lib/giving/giving-stripe";
import { resolveConnectedAccountForCharges, getStripeForMode } from "@/lib/payments/stripe-connect";
import { quoteProcessingCostCoverage } from "@/lib/giving/processing-cost-coverage";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  fundId: z.string().min(1).max(64),
  amount: z.number().positive().max(1_000_000),
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"]),
  confirmDuplicate: z.boolean().optional(),
  /** CONNECT-F: optional, absent on the frozen vc4 binary — behaves exactly
   * as before when omitted (§71 backward-compat). */
  coverProcessingCosts: z.boolean().optional(),
});

/**
 * CORE-GIVE-L — mobile recurring setup. Same C-era discipline: OUR
 * PENDING_SETUP schedule first, subscription checkout in the SYSTEM
 * browser, webhook completes linkage. §92 duplicate guard intact.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:giving:recurring", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { session: mobileSession, organizationId, memberId } = await requireMobileMembership(request, input.organizationId);

    const { schedule, fund, amount } = await createPendingSchedule({
      organizationId,
      fundId: input.fundId,
      amount: input.amount,
      frequency: input.frequency,
      programId: null,
      pledgeId: null,
      confirmDuplicate: input.confirmDuplicate ?? false,
      contributorUserId: mobileSession.userId,
      memberId,
      coverProcessingCosts: input.coverProcessingCosts ?? false,
    });

    const { coverageCents } = schedule.coverProcessingCosts
      ? await quoteProcessingCostCoverage(organizationId, Math.round(amount * 100))
      : { coverageCents: 0 };
    const chargeUnitAmount = Math.round(amount * 100) + coverageCents;

    const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(organizationId);
    const mode = accountMode as "test" | "live";

    const user = await prisma.user.findUnique({ where: { id: mobileSession.userId }, select: { email: true, displayName: true } });
    const [customerId, productId] = await Promise.all([
      getOrCreateConnectedGivingCustomer({
        organizationId,
        userId: mobileSession.userId,
        memberId,
        stripeConnectedAccountId,
        accountMode: mode,
        email: user?.email ?? null,
        name: user?.displayName ?? null,
      }),
      getOrCreateConnectedGivingProduct({ organizationId, stripeConnectedAccountId, accountMode: mode }),
    ]);

    const stripe = await getStripeForMode(mode);
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");
    const givingMetadata = {
      product: "Unestra Giving",
      platformOwner: "APH Technologies, LLC",
      paymentType: "giving-recurring",
      organizationId,
      scheduleId: schedule.id,
      givingFundId: fund.id,
      stripeConnectedAccountId,
      environment: process.env.NODE_ENV ?? "development",
    };

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product: productId,
              recurring: stripeIntervalFor(input.frequency),
              unit_amount: chargeUnitAmount,
            },
            quantity: 1,
          },
        ],
        subscription_data: { metadata: givingMetadata },
        success_url: `${baseUrl}/giving/checkout-complete?state=success&recurring=1`,
        cancel_url: `${baseUrl}/giving/checkout-complete?state=cancelled`,
        metadata: givingMetadata,
      },
      { stripeAccount: stripeConnectedAccountId }
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return Response.json({ ok: true, data: { url: session.url } });
  });
}
