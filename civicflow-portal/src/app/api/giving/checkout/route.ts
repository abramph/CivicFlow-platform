import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
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
  memo: z.string().max(280).nullable().optional(),
  /** CONNECT-F (§41): opt-in only — ignored server-side unless the org's
   * mode is OPTIONAL_CONTRIBUTOR_COVERAGE. */
  coverProcessingCosts: z.boolean().optional(),
});

/**
 * CORE-GIVE-B — member Give Now checkout. Attribution metadata is stamped
 * SERVER-SIDE from the authenticated member session; the recording itself
 * happens exclusively in the webhook (§7 — the redirect proves nothing).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:giving:checkout", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const memberSession = await requireMemberWebSession(input.organizationId);

    const { amount, fund, program, pledge } = await validateGivingRequest({
      organizationId: memberSession.organizationId,
      fundId: input.fundId,
      amount: input.amount,
      programId: input.programId ?? null,
      pledgeId: input.pledgeId ?? null,
      contributorUserId: memberSession.userId,
    });

    // CONNECT-C (§10/§55): resolved SERVER-SIDE from the organization — the
    // org's OWN connected account or a clean 409, never the platform account.
    const { stripeConnectedAccountId, accountMode } = await resolveConnectedAccountForCharges(memberSession.organizationId);
    const stripe = await getStripeForMode(accountMode as "test" | "live");
    const env = getServerEnv();
    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");
    const orgSuffix = `&org=${encodeURIComponent(memberSession.organizationId)}`;

    const baseAmountCents = Math.round(amount * 100);
    // COST-POLICY v2 (§2): giving is VOLUNTARY unless the program itself is
    // a REQUIRED DUES program (Core Giving 2.0's own server-enforced rule).
    // With v2 disabled this reproduces CONNECT-F's optional opt-in exactly.
    const nature = derivePaymentNature({
      purpose: "giving",
      programType: program?.type ?? null,
      programObligationNature: program?.obligationNature ?? null,
    });
    const plan = await resolveCoveragePlan({
      organizationId: memberSession.organizationId,
      nature,
      baseCents: baseAmountCents,
      payerOptedIn: input.coverProcessingCosts === true,
    });
    const coverageCents = plan.coverageCents;

    // §7: first-party pending record persisted BEFORE redirect.
    const pending = await createPendingPayment({
      organizationId: memberSession.organizationId,
      memberId: memberSession.memberId,
      contributorUserId: memberSession.userId,
      paymentPurpose: "giving",
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

    logGivingEvent("GIVING_CHECKOUT_STARTED", { organizationId: memberSession.organizationId, fundId: fund.id, amountCents: baseAmountCents });
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // CORE-GIVE-K: also stamp the PAYMENT INTENT so intents are
        // org-searchable in Stripe (session metadata does not propagate).
        payment_intent_data: {
          metadata: { organizationId: memberSession.organizationId, paymentType: "giving" },
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
        success_url: `${baseUrl}/m/giving/success?session_id={CHECKOUT_SESSION_ID}${orgSuffix}`,
        cancel_url: `${baseUrl}/m/giving?org=${encodeURIComponent(memberSession.organizationId)}`,
        metadata: {
          product: "Unestra",
          platformOwner: "APH Technologies, LLC",
          paymentType: "giving",
          organizationId: memberSession.organizationId,
          // CONNECT-C (§20): cross-checked against event.account in the
          // connected-account webhook — never trusted alone.
          stripeConnectedAccountId,
          // CONNECT-F (§36): snapshotted split — the webhook records exactly
          // this, never a value recomputed from a possibly-changed rate.
          givingBaseAmountCents: String(baseAmountCents),
          givingCoverageAmountCents: String(coverageCents),
          givingFundId: fund.id,
          givingProgramId: program?.id ?? "",
          memberId: memberSession.memberId,
          contributorUserId: memberSession.userId,
          givingPledgeId: pledge?.id ?? "",
          anonymityMode: input.anonymityMode ?? "NONE",
          givingMemo: input.memo?.slice(0, 200) ?? "",
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

    return Response.json({ ok: true, url: session.url });
  });
}
