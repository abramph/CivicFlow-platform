import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { validateGivingRequest } from "@/lib/giving/checkout";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { resolveConnectedAccountForCharges, getStripeForMode } from "@/lib/payments/stripe-connect";
import { derivePaymentNature, resolveCoveragePlan } from "@/lib/payments/cost-policy";
import { attachStripeSession, createPendingPayment } from "@/lib/payments/pending-payments";
import { getServerEnv } from "@/lib/env";
import { logGivingEvent } from "@/lib/giving/telemetry";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  fundId: z.string().min(1).max(64),
  amount: z.number().positive().max(1_000_000),
  programId: z.string().max(64).nullable().optional(),
  pledgeId: z.string().max(64).nullable().optional(),
  anonymityMode: z.enum(["NONE", "PUBLICLY_ANONYMOUS"]).optional(),
  /** CONNECT-F: optional, absent on the frozen vc4 binary — behaves exactly
   * as before when omitted (§71 backward-compat). */
  coverProcessingCosts: z.boolean().optional(),
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

    const baseAmountCents = Math.round(amount * 100);
    // COST-POLICY v2 (§2): same server-side derivation as the web route —
    // the mobile client still sends only the boolean opt-in.
    const nature = derivePaymentNature({
      purpose: "giving",
      programType: program?.type ?? null,
      programObligationNature: program?.obligationNature ?? null,
    });
    const plan = await resolveCoveragePlan({
      organizationId,
      nature,
      baseCents: baseAmountCents,
      payerOptedIn: input.coverProcessingCosts === true,
    });
    const coverageCents = plan.coverageCents;

    // §7: first-party pending record persisted BEFORE redirect.
    const pending = await createPendingPayment({
      organizationId,
      memberId,
      contributorUserId: mobileSession.userId,
      paymentPurpose: "mobile-giving",
      paymentNature: nature,
      fundId: fund.id,
      contributionProgramId: program?.id ?? null,
      obligationCents: baseAmountCents,
      processingCostCents: coverageCents,
      coverageMode: plan.coverageMode,
      coverageRequired: plan.required,
      coveragePolicyVersion: plan.policyVersion,
      stripeConnectedAccountId,
    });

    logGivingEvent("GIVING_CHECKOUT_STARTED", { organizationId, fundId: fund.id, amountCents: baseAmountCents });
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
              unit_amount: plan.totalCents,
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
          givingBaseAmountCents: String(baseAmountCents),
          givingCoverageAmountCents: String(coverageCents),
          givingFundId: fund.id,
          givingProgramId: program?.id ?? "",
          memberId,
          contributorUserId: mobileSession.userId,
          givingPledgeId: pledge?.id ?? "",
          anonymityMode: input.anonymityMode ?? "NONE",
          givingMemo: "",
          // COST-POLICY v2 (§7) — cross-check only; the PendingPayment row
          // is the accounting record.
          paymentNature: nature,
          obligationAmount: String(baseAmountCents),
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
    return Response.json({ ok: true, data: { url: session.url } });
  });
}
