import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { validateGivingRequest } from "@/lib/giving/checkout";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { resolveConnectedAccountForCharges, getStripeForMode } from "@/lib/payments/stripe-connect";
import { getServerEnv } from "@/lib/env";
import { logGivingEvent } from "@/lib/giving/telemetry";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  fundId: z.string().min(1).max(64),
  amount: z.number().positive().max(1_000_000),
  programId: z.string().max(64).nullable().optional(),
  pledgeId: z.string().max(64).nullable().optional(),
  anonymityMode: z.enum(["NONE", "PUBLICLY_ANONYMOUS"]).optional(),
});

/**
 * CORE-GIVE-L — mobile Give Now. Identical discipline to the web member
 * checkout (§64: no card entry in-app — the app opens this URL in the
 * system browser; the webhook is the only recorder). Attribution metadata
 * is stamped from the MOBILE session server-side.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:giving:checkout", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { session: mobileSession, organizationId, memberId } = await requireMobileMembership(request, input.organizationId);

    const { amount, fund, program, pledge } = await validateGivingRequest({
      organizationId,
      fundId: input.fundId,
      amount: input.amount,
      programId: input.programId ?? null,
      pledgeId: input.pledgeId ?? null,
      contributorUserId: mobileSession.userId,
    });

    const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(organizationId);
    const stripe = await getStripeForMode(accountMode as "test" | "live");
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

    logGivingEvent("GIVING_CHECKOUT_STARTED", { organizationId, fundId: fund.id, amountCents: Math.round(amount * 100) });
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_intent_data: {
          metadata: { organizationId, paymentType: "giving" },
        },
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: program ? `${program.name} — ${fund.name}` : fund.name,
                description: "Contribution",
              },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/giving/checkout-complete?state=success`,
        cancel_url: `${baseUrl}/giving/checkout-complete?state=cancelled`,
        metadata: {
          product: "Unestra",
          platformOwner: "APH Technologies, LLC",
          paymentType: "giving",
          organizationId,
          stripeConnectedAccountId,
          givingFundId: fund.id,
          givingProgramId: program?.id ?? "",
          memberId,
          contributorUserId: mobileSession.userId,
          givingPledgeId: pledge?.id ?? "",
          anonymityMode: input.anonymityMode ?? "NONE",
          givingMemo: "",
          environment: process.env.NODE_ENV ?? "development",
        },
      },
      { stripeAccount: stripeConnectedAccountId }
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return Response.json({ ok: true, data: { url: session.url } });
  });
}
