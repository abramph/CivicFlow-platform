import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
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
  programId: z.string().max(64).nullable().optional(),
  pledgeId: z.string().max(64).nullable().optional(),
  /** §92: the duplicate-schedule guard 409s unless this is explicitly true. */
  confirmDuplicate: z.boolean().optional(),
  /** CONNECT-F (§41): opt-in only — ignored server-side unless the org's
   * mode is OPTIONAL_CONTRIBUTOR_COVERAGE. */
  coverProcessingCosts: z.boolean().optional(),
});

/**
 * CORE-GIVE-C — recurring giving setup. Creates OUR schedule row first
 * (PENDING_SETUP), then a subscription-mode Checkout Session whose
 * price_data references the org's single giving Product with the member's
 * chosen amount (§10 — no price sprawl). Stripe collects the payment
 * method; card data never touches Unestra. The webhook completes linkage.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:giving:recurring-checkout", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const memberSession = await requireMemberWebSession(input.organizationId);

    const { schedule, fund, amount } = await createPendingSchedule({
      organizationId: memberSession.organizationId,
      fundId: input.fundId,
      amount: input.amount,
      frequency: input.frequency,
      programId: input.programId ?? null,
      pledgeId: input.pledgeId ?? null,
      confirmDuplicate: input.confirmDuplicate ?? false,
      contributorUserId: memberSession.userId,
      memberId: memberSession.memberId,
      coverProcessingCosts: input.coverProcessingCosts ?? false,
    });

    // CONNECT-F: gross-up happens AFTER the schedule's own `amount` is fixed
    // (fund principal, immutable) — the subscription item is priced at the
    // grossed-up total only when the (now-persisted, org-gated) toggle is on.
    const { coverageCents } = schedule.coverProcessingCosts
      ? await quoteProcessingCostCoverage(memberSession.organizationId, Math.round(amount * 100))
      : { coverageCents: 0 };
    const chargeUnitAmount = Math.round(amount * 100) + coverageCents;

    // CONNECT-D (§10/§55): resolved SERVER-SIDE from the organization — the
    // org's OWN connected account or a clean 409, never the platform account.
    const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(memberSession.organizationId);
    const mode = accountMode as "test" | "live";

    const user = await prisma.user.findUnique({ where: { id: memberSession.userId }, select: { email: true, displayName: true } });
    const [customerId, productId] = await Promise.all([
      getOrCreateConnectedGivingCustomer({
        organizationId: memberSession.organizationId,
        userId: memberSession.userId,
        memberId: memberSession.memberId,
        stripeConnectedAccountId,
        accountMode: mode,
        email: user?.email ?? null,
        name: user?.displayName ?? null,
      }),
      getOrCreateConnectedGivingProduct({ organizationId: memberSession.organizationId, stripeConnectedAccountId, accountMode: mode }),
    ]);

    const stripe = await getStripeForMode(mode);
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");
    const recurring = stripeIntervalFor(input.frequency);
    const givingMetadata = {
      product: "Unestra Giving",
      platformOwner: "APH Technologies, LLC",
      paymentType: "giving-recurring",
      organizationId: memberSession.organizationId,
      scheduleId: schedule.id,
      givingFundId: fund.id,
      // CONNECT-D (§20): cross-checked against event.account in the
      // connected-account webhook — never trusted alone.
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
              recurring,
              unit_amount: chargeUnitAmount,
            },
            quantity: 1,
          },
        ],
        subscription_data: { metadata: givingMetadata },
        success_url: `${baseUrl}/m/giving/success?session_id={CHECKOUT_SESSION_ID}&recurring=1&org=${encodeURIComponent(memberSession.organizationId)}`,
        cancel_url: `${baseUrl}/m/giving?org=${encodeURIComponent(memberSession.organizationId)}`,
        metadata: givingMetadata,
      },
      { stripeAccount: stripeConnectedAccountId }
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");

    return Response.json({ ok: true, url: session.url });
  });
}
