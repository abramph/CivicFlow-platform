import { prisma } from "@/lib/prisma";
import { getStripeForMode } from "@/lib/payments/stripe-connect";
import { getGlobalCostPolicyFlags } from "@/lib/payments/cost-policy";

/**
 * COST-POLICY v2 (§10) — capture the ACTUAL processor fee and net deposit
 * from the charge's balance transaction, after the payment has been
 * recorded. Reconciliation data ONLY:
 *
 *  - never used for member status, obligation allocation, campaign
 *    progress, statements, or any principal math;
 *  - never assumed equal to the payer-covered estimate — the whole point
 *    is reporting the difference (§10: estimate vs actual vs absorbed);
 *  - best-effort by design: any failure here leaves the payment recorded
 *    exactly as before and logs, it can never un-record or block a payment.
 */
export async function captureActualProcessorFee(input: {
  accountMode: "test" | "live";
  stripeConnectedAccountId: string;
  providerPaymentIntentId: string | null;
  providerSessionId: string;
  pendingPaymentId: string | null;
}): Promise<void> {
  if (!getGlobalCostPolicyFlags().paymentCostReconciliation) return;
  if (!input.providerPaymentIntentId) return;

  try {
    const stripe = await getStripeForMode(input.accountMode);
    // The balance transaction can lag the webhook by moments; retry briefly
    // before giving up. A missing capture is still only a reconciliation
    // gap (fillable by a later sweep), never an accounting problem.
    let balanceTx: { fee: number; net: number } | null = null;
    for (let attempt = 0; attempt < 3 && !balanceTx; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
      const intent = await stripe.paymentIntents.retrieve(
        input.providerPaymentIntentId,
        { expand: ["latest_charge.balance_transaction"] },
        { stripeAccount: input.stripeConnectedAccountId }
      );
      const charge = typeof intent.latest_charge === "string" ? null : intent.latest_charge;
      balanceTx = charge && typeof charge.balance_transaction !== "string" ? (charge.balance_transaction ?? null) : null;
    }
    if (!balanceTx) return; // Still not available — a later reconciliation sweep can fill it.

    const feeCents = balanceTx.fee;
    const netCents = balanceTx.net;
    if (!Number.isInteger(feeCents) || !Number.isInteger(netCents) || feeCents < 0) return;

    // Stamp whichever record this session produced. Contribution rows carry
    // the payment intent; DuesPayment rows carry the session id as their
    // reference. Both updates are no-ops when no row matches.
    await prisma.contribution.updateMany({
      where: { providerPaymentIntentId: input.providerPaymentIntentId, processorFeeActualCents: null },
      data: {
        processorFeeActualCents: feeCents,
        netDepositedCents: netCents,
        ...(input.pendingPaymentId ? { pendingPaymentId: input.pendingPaymentId } : {}),
      },
    });
    await prisma.duesPayment.updateMany({
      where: { reference: input.providerSessionId, processorFeeActualCents: null },
      data: {
        processorFeeActualCents: feeCents,
        netDepositedCents: netCents,
        ...(input.pendingPaymentId ? { pendingPaymentId: input.pendingPaymentId } : {}),
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "cost_policy_fee_capture_failed",
        sessionId: input.providerSessionId,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}
