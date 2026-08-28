import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createAuditEvent } from "@/lib/audit";
import { requireRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CONNECT-C (docs/stripe-connect-architecture.md §4/§20) — events on
 * CONNECTED accounts only (direct-charge Giving/public Giving). Separate
 * from /api/webhooks/stripe (platform SaaS + legacy payment links), which
 * is subscribed to "Events on your account" only and will never receive
 * these. THE RULES:
 *  - `event.account` is the PRIMARY tenant signal, resolved against our own
 *    OrganizationStripeAccount row — never trusted from session metadata
 *    alone (§20);
 *  - metadata.organizationId, when present, must AGREE with the
 *    account-resolved org; a mismatch is rejected and logged, nothing is
 *    recorded;
 *  - idempotency reuses the same StripeWebhookEvent table as the platform
 *    webhook — Stripe event ids are globally unique regardless of which
 *    account produced them.
 */
/**
 * Stripe API 2025-03+ ("basil"/"dahlia") removed the top-level
 * `invoice.subscription` string — the link now lives at
 * `invoice.parent.subscription_details.subscription`. Events arrive in
 * whatever API version the delivering endpoint (or the CLI) pins, so read
 * both shapes; returning null on a subscription-billed invoice would
 * silently skip recurring-gift recording.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as { subscription?: unknown }).subscription;
  if (typeof legacy === "string") return legacy;
  const parent = (invoice as { parent?: { subscription_details?: { subscription?: unknown } | null } | null }).parent;
  const nested = parent?.subscription_details?.subscription;
  return typeof nested === "string" ? nested : null;
}

export async function POST(request: Request) {
  const rateLimited = await requireRateLimit({
    scope: "api:webhooks:stripe-connect",
    request,
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const env = getServerEnv();
  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: "Connected-account webhooks are not configured" }, { status: 501 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ ok: false, error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  // Signature verification is pure HMAC over (body, secret) — it needs a
  // Stripe client only as a vehicle for `.webhooks`, not for its API key.
  // We don't yet know which connected account (or mode) produced this event,
  // so there's nothing else that could select a different client here.
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch (err) {
    // CONNECT-G: this used to fail SILENTLY — a stale secret produced a
    // steady stream of 400s with no trace anywhere. Never log the body or
    // signature header (may embed sensitive payload fragments); the error
    // message from Stripe's SDK is safe (verification-failure reason only).
    console.error(
      JSON.stringify({
        event: "stripe_connect_webhook_signature_invalid",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return Response.json({ ok: false, error: "Invalid Stripe signature" }, { status: 400 });
  }

  const connectedAccountId = event.account ?? null;
  if (!connectedAccountId) {
    console.error(JSON.stringify({ event: "stripe_connect_webhook_missing_account", stripeEventId: event.id, stripeEventType: event.type }));
    return Response.json({ ok: false, error: "Missing connected account context" }, { status: 400 });
  }

  const accountRow = await prisma.organizationStripeAccount.findUnique({ where: { stripeAccountId: connectedAccountId } });
  if (!accountRow) {
    console.error(JSON.stringify({ event: "stripe_connect_webhook_unknown_account", stripeAccountId: connectedAccountId, stripeEventId: event.id }));
    return Response.json({ ok: false, error: "Unknown connected account" }, { status: 400 });
  }
  const organizationId = accountRow.organizationId;

  try {
    await prisma.stripeWebhookEvent.create({
      data: { stripeEventId: event.id, type: event.type },
    });
  } catch {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    switch (event.type) {
      // ACH (§2): us_bank_account debits settle asynchronously — Stripe
      // fires checkout.session.completed with payment_status "unpaid",
      // then async_payment_succeeded (or _failed) days later. The recording
      // logic below keys on payment_status === "paid", so an ACH session
      // records NOTHING at completion and everything at settlement — the
      // member's obligation is allocated only by the authoritative
      // successful-payment event.
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // ACH in flight: explicit Processing state on our first-party
        // record; no allocation.
        if (session.mode === "payment" && session.payment_status === "unpaid") {
          const { markPendingProcessing } = await import("@/lib/payments/pending-payments");
          await markPendingProcessing(session.id);
          break;
        }

        // §20: metadata must AGREE with the account-resolved tenant. A
        // mismatch is rejected and logged; nothing is recorded from either
        // side alone.
        if (session.metadata?.organizationId && session.metadata.organizationId !== organizationId) {
          console.error(
            JSON.stringify({
              event: "stripe_connect_webhook_tenant_mismatch",
              stripeAccountId: connectedAccountId,
              metadataOrgId: session.metadata.organizationId,
              resolvedOrgId: organizationId,
              stripeEventId: event.id,
            })
          );
          break;
        }

        // COST-POLICY v2 (§10): settle Unestra's first-party pending record
        // before ANY recording. NOT_FOUND = legacy session (metadata
        // cross-checks below still apply, unchanged). MISMATCH = the paid
        // total or account differs from what was authorized — record
        // NOTHING; the reason is preserved on the PendingPayment row.
        let settledPendingPaymentId: string | null = null;
        if (session.mode === "payment" && session.payment_status === "paid") {
          const { settlePendingPaymentBySession } = await import("@/lib/payments/pending-payments");
          const settlement = await settlePendingPaymentBySession({
            stripeSessionId: session.id,
            paidTotalCents: session.amount_total ?? 0,
            stripeConnectedAccountId: connectedAccountId,
          });
          if (settlement.outcome === "MISMATCH") {
            console.error(
              JSON.stringify({
                event: "cost_policy_pending_mismatch",
                sessionId: session.id,
                organizationId,
                reason: settlement.reason,
              })
            );
            await createAuditEvent({
              organizationId,
              action: "update",
              entityType: "stripe_webhook",
              entityId: session.id,
              metadata: { eventType: event.type, connected: true, outcome: "PENDING_MISMATCH", reason: settlement.reason },
            });
            break;
          }
          if (settlement.outcome !== "NOT_FOUND" && (session.currency ?? "usd") !== "usd") {
            console.error(
              JSON.stringify({ event: "cost_policy_currency_rejected", sessionId: session.id, organizationId, currency: session.currency })
            );
            break;
          }
          if (settlement.outcome === "SETTLED" || settlement.outcome === "ALREADY_COMPLETED") {
            settledPendingPaymentId = settlement.record.id;
          }
        }

        // CONNECT-D: setup-mode session completing a recurring payment-method
        // update (mirrors the platform webhook's giving-method-update branch).
        if (session.mode === "setup" && session.metadata?.paymentType === "giving-method-update") {
          const setupIntentId =
            typeof session.setup_intent === "string" ? session.setup_intent : (session.setup_intent?.id ?? null);
          if (session.metadata?.scheduleId && setupIntentId) {
            const { applyPaymentMethodUpdate } = await import("@/lib/giving/recurring-self-service");
            const applied = await applyPaymentMethodUpdate({
              organizationId,
              scheduleId: session.metadata.scheduleId,
              setupIntentId,
            });
            if (applied === "REJECTED") {
              console.error(
                JSON.stringify({ event: "giving_pm_update_connect_webhook_rejected", sessionId: session.id, organizationId })
              );
            }
          }
          break;
        }

        // CONNECT-D: a giving-recurring checkout is MEMBER MONEY — it must
        // never be upserted into the SaaS Subscription table (which only
        // ever lives on the platform account and can never appear here).
        if (session.metadata?.paymentType === "giving-recurring") {
          if (session.subscription && session.metadata?.scheduleId) {
            const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
            const { linkScheduleFromCheckout } = await import("@/lib/giving/recurring");
            const linked = await linkScheduleFromCheckout({
              scheduleId: session.metadata.scheduleId,
              organizationId,
              providerSubscriptionId: subId,
              providerCustomerId: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
              stripeConnectedAccountId: connectedAccountId,
            });
            if (linked === "REJECTED") {
              console.error(
                JSON.stringify({ event: "giving_recurring_connect_webhook_link_rejected", sessionId: session.id, organizationId })
              );
            }
            await createAuditEvent({
              organizationId,
              action: "update",
              entityType: "stripe_webhook",
              entityId: session.id,
              metadata: { eventType: event.type, givingRecurring: true, connected: true, outcome: linked },
            });
          }
          break;
        }

        if (session.metadata?.paymentType === "giving" && session.payment_status === "paid") {
          const { recordGivingContribution } = await import("@/lib/giving/checkout");
          const result = await recordGivingContribution({
            organizationId,
            fundId: session.metadata?.givingFundId ?? "",
            programId: session.metadata?.givingProgramId || null,
            memberId: session.metadata?.memberId || null,
            contributorUserId: session.metadata?.contributorUserId || null,
            pledgeId: session.metadata?.givingPledgeId || null,
            anonymityMode: session.metadata?.anonymityMode || null,
            memo: session.metadata?.givingMemo || null,
            amountTotalCents: session.amount_total ?? 0,
            currency: session.currency ?? "usd",
            providerPaymentIntentId:
              typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
            providerSessionId: session.id,
            stripeConnectedAccountId: connectedAccountId,
            // CONNECT-F: base/coverage split snapshotted at checkout time.
            baseAmountCents: session.metadata?.givingBaseAmountCents ? Number(session.metadata.givingBaseAmountCents) : null,
            coverageAmountCents: session.metadata?.givingCoverageAmountCents ? Number(session.metadata.givingCoverageAmountCents) : null,
          });
          if (result.outcome === "REJECTED") {
            console.error(
              JSON.stringify({ event: "giving_connect_webhook_rejected", reason: result.reason, sessionId: session.id, organizationId })
            );
          }
          await createAuditEvent({
            organizationId,
            action: "update",
            entityType: "stripe_webhook",
            entityId: session.id,
            metadata: { eventType: event.type, giving: true, connected: true, outcome: result.outcome },
          });
          if (result.outcome !== "REJECTED") {
            const { captureActualProcessorFee } = await import("@/lib/payments/reconciliation");
            await captureActualProcessorFee({
              accountMode: accountRow.accountMode as "test" | "live",
              stripeConnectedAccountId: connectedAccountId,
              providerPaymentIntentId:
                typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
              providerSessionId: session.id,
              pendingPaymentId: settledPendingPaymentId,
            });
          }
          break;
        }

        if (session.metadata?.paymentType === "public-giving" && session.payment_status === "paid") {
          const { recordPublicGivingContribution } = await import("@/lib/giving/public-giving");
          const result = await recordPublicGivingContribution({
            organizationId,
            fundId: session.metadata?.givingFundId ?? "",
            guestName: session.metadata?.guestName || null,
            guestEmail: session.metadata?.guestEmail || null,
            anonymityMode: session.metadata?.anonymityMode || null,
            amountTotalCents: session.amount_total ?? 0,
            currency: session.currency ?? "usd",
            providerPaymentIntentId:
              typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
            providerSessionId: session.id,
            stripeConnectedAccountId: connectedAccountId,
            baseAmountCents: session.metadata?.givingBaseAmountCents ? Number(session.metadata.givingBaseAmountCents) : null,
            coverageAmountCents: session.metadata?.givingCoverageAmountCents ? Number(session.metadata.givingCoverageAmountCents) : null,
          });
          if (result.outcome === "REJECTED") {
            console.error(
              JSON.stringify({
                event: "public_giving_connect_webhook_rejected",
                reason: result.reason,
                sessionId: session.id,
                organizationId,
              })
            );
          }
          await createAuditEvent({
            organizationId,
            action: "update",
            entityType: "stripe_webhook",
            entityId: session.id,
            metadata: { eventType: event.type, publicGiving: true, connected: true, outcome: result.outcome },
          });
          if (result.outcome !== "REJECTED") {
            const { captureActualProcessorFee } = await import("@/lib/payments/reconciliation");
            await captureActualProcessorFee({
              accountMode: accountRow.accountMode as "test" | "live",
              stripeConnectedAccountId: connectedAccountId,
              providerPaymentIntentId:
                typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
              providerSessionId: session.id,
              pendingPaymentId: settledPendingPaymentId,
            });
          }
          break;
        }

        // Volunteer Hour Requirements & Buyout program, VH-F
        // (docs/pta-volunteer-hours.md): a family's buyout purchase.
        // Mirrors the "giving" branch's structure exactly, but never
        // re-quotes — recordVolunteerBuyoutPurchase validates the paid
        // total against the ALREADY-SNAPSHOTTED purchase row created at
        // checkout time (the rate-lock point), same rigor as giving's
        // coverage-split cross-check.
        if (session.metadata?.paymentType === "pta-volunteer-buyout" && session.payment_status === "paid") {
          const purchaseId = session.metadata?.buyoutPurchaseId;
          if (!purchaseId) {
            console.error(JSON.stringify({ event: "pta_volunteer_buyout_webhook_missing_purchase_id", sessionId: session.id, organizationId }));
            break;
          }
          const { recordVolunteerBuyoutPurchase } = await import("@/lib/labs/pta/volunteer-hours/purchases");
          const result = await recordVolunteerBuyoutPurchase({
            organizationId,
            purchaseId,
            amountTotalCents: session.amount_total ?? 0,
            stripeConnectedAccountId: connectedAccountId,
            providerPaymentIntentId:
              typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
            providerSessionId: session.id,
          });
          if (result.outcome === "REJECTED") {
            console.error(
              JSON.stringify({ event: "pta_volunteer_buyout_webhook_rejected", reason: result.reason, sessionId: session.id, organizationId })
            );
          }
          await createAuditEvent({
            organizationId,
            action: "update",
            entityType: "stripe_webhook",
            entityId: session.id,
            metadata: { eventType: event.type, ptaVolunteerBuyout: true, connected: true, outcome: result.outcome },
          });
          break;
        }

        // CONNECT-E: dues / campaign / event contributions collected via a
        // payment link. Mirrors the platform webhook's own paymentLinkId
        // branch exactly (§8 legacy coexistence — that branch stays in
        // place for anything predating this migration); this copy runs for
        // every NEW payment link checkout, which now creates its session on
        // the org's connected account.
        {
          const paymentLinkId = session.metadata?.paymentLinkId;
          const linkPaymentType = session.metadata?.paymentType || null;
          const payingMemberId = session.metadata?.memberId || null;

          if (paymentLinkId && session.payment_status === "paid") {
            const amountTotal = session.amount_total ?? 0;

            // FEE-COVER-C: validate the snapshotted base/coverage split
            // against Stripe's own amount_total — same rigor as giving.
            // Absent metadata (legacy sessions) = full amount is base.
            // Present-but-inconsistent metadata = tampering/staleness:
            // record NOTHING and log, never guess.
            const { resolveCoverageSplit } = await import("@/lib/giving/processing-cost-coverage");
            const split = resolveCoverageSplit(
              amountTotal,
              session.metadata?.linkBaseAmountCents ? Number(session.metadata.linkBaseAmountCents) : null,
              session.metadata?.linkCoverageAmountCents ? Number(session.metadata.linkCoverageAmountCents) : null
            );
            if (split.baseAmountCents === null) {
              console.error(
                JSON.stringify({ event: "payment_link_coverage_split_rejected", sessionId: session.id, organizationId, paymentLinkId })
              );
              break;
            }
            const baseDollars = split.baseAmountCents / 100;
            const coverageDollars = split.coverageAmountCents / 100;
            const totalDollars = amountTotal / 100;

            if (linkPaymentType === "dues" && payingMemberId) {
              const charge = await prisma.duesCharge.findFirst({
                where: { organizationId, memberId: payingMemberId, status: { in: ["PENDING", "PARTIAL"] } },
                orderBy: [{ dueDate: "asc" }],
              });

              const { recordDuesPayment } = await import("@/lib/dues-payments");
              // `amount` is the BASE figure — it alone settles the member's
              // DuesCharge obligation; voluntary coverage never inflates
              // what the member is credited as having paid toward dues.
              await recordDuesPayment({
                organizationId,
                memberId: payingMemberId,
                duesChargeId: charge?.id ?? null,
                amount: baseDollars,
                paymentDate: new Date(),
                method: "STRIPE",
                reference: session.id,
                notes: `Paid by card via payment link ${paymentLinkId}`,
                stripeConnectedAccountId: connectedAccountId,
                providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
                processingCostCoverageAmount: split.coverageAmountCents > 0 ? coverageDollars : null,
                totalChargedAmount: totalDollars,
                charge,
              });
            } else {
              const campaignId = session.metadata?.campaignId || null;
              const eventId = session.metadata?.eventId || null;
              const contributorName = session.metadata?.contributorName || null;
              const contributorEmail =
                typeof session.customer_details?.email === "string" ? session.customer_details.email : null;

              // `amount` stays the BASE figure (§37: coverage is never fund/
              // campaign principal) — campaign/event progress sums `amount`.
              await prisma.contribution.create({
                data: {
                  organizationId,
                  amount: baseDollars,
                  contributionDate: new Date(),
                  paymentMethod: "STRIPE",
                  source: campaignId ? "CAMPAIGN_PAGE" : eventId ? "EVENT_PAGE" : "MANUAL",
                  campaignId: campaignId || null,
                  eventId: eventId || null,
                  contributorName: contributorName || (contributorEmail ? contributorEmail : null),
                  notes: `Payment link: ${paymentLinkId}`,
                  receiptRequested: Boolean(contributorEmail),
                  stripeConnectedAccountId: connectedAccountId,
                  providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
                  providerPaymentIntentId:
                    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
                  processingCostCoverageAmount: split.coverageAmountCents > 0 ? coverageDollars : null,
                  totalChargedAmount: totalDollars,
                  pendingPaymentId: settledPendingPaymentId,
                },
              });
            }

            await prisma.paymentLink.update({
              where: { id: paymentLinkId },
              data: { useCount: { increment: 1 } },
            });
            await createAuditEvent({
              organizationId,
              action: "update",
              entityType: "stripe_webhook",
              entityId: session.id,
              metadata: { eventType: event.type, paymentLinkId, connected: true },
            });
            const { captureActualProcessorFee } = await import("@/lib/payments/reconciliation");
            await captureActualProcessorFee({
              accountMode: accountRow.accountMode as "test" | "live",
              stripeConnectedAccountId: connectedAccountId,
              providerPaymentIntentId:
                typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
              providerSessionId: session.id,
              pendingPaymentId: settledPendingPaymentId,
            });
          }
        }

        break;
      }

      // ACH (§2): the debit failed or was returned before settlement.
      // Nothing was allocated at completion, so nothing is reversed — the
      // obligation stays open and the failure is explicit on our record.
      // (Returns AFTER settlement arrive as refund events and reverse
      // through the existing auditable refund path below.)
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const { markPendingFailed } = await import("@/lib/payments/pending-payments");
        await markPendingFailed(session.id, "async payment failed or returned before settlement");
        await createAuditEvent({
          organizationId,
          action: "update",
          entityType: "stripe_webhook",
          entityId: session.id,
          metadata: { eventType: event.type, connected: true, outcome: "ASYNC_PAYMENT_FAILED" },
        });
        break;
      }

      case "charge.refunded": {
        // CORE-GIVE-K / CONNECT-C (§17): the charge's payment intent locates
        // OUR contribution, scoped to both the resolved org AND the resolved
        // connected account — a refund event can only apply to a
        // contribution that was actually charged on that same account.
        //
        // The event payload's own `charge.refunds` is expand-only and comes
        // back EMPTY on our real webhook delivery (confirmed against a live
        // test-mode connected-account charge, 2026-08). Re-fetch the charge
        // (on the connected account) with an explicit expand so every
        // refund is applied under its OWN real `refund.id` instead of a
        // synthetic charge-derived fallback that can't distinguish two
        // different refunds on the same charge — the exact bug this
        // replaces. applyProviderRefund's unique constraint makes
        // re-processing already-applied refunds on every delivery a safe
        // no-op, so this is also naturally replay- and reorder-safe.
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId =
          typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
        if (paymentIntentId) {
          const contribution = await prisma.contribution.findFirst({
            where: { organizationId, providerPaymentIntentId: paymentIntentId, stripeConnectedAccountId: connectedAccountId },
            select: { id: true },
          });
          if (contribution) {
            // `stripe` (used above only for the mode-agnostic signature
            // check) is the platform's fixed-mode key — wrong for a real
            // API call against a connected account that may itself be in
            // Stripe test mode. Use the account's OWN recorded mode instead.
            const { getStripeForMode } = await import("@/lib/payments/stripe-connect");
            const modeStripe = await getStripeForMode((accountRow.accountMode as "test" | "live") ?? "live");
            const fullCharge = await modeStripe.charges.retrieve(charge.id, { expand: ["refunds"] }, { stripeAccount: connectedAccountId });
            const { applyProviderRefund } = await import("@/lib/giving/refunds");
            for (const refund of fullCharge.refunds?.data ?? []) {
              await applyProviderRefund({
                organizationId,
                providerPaymentIntentId: paymentIntentId,
                providerRefundId: refund.id,
                amountRefundedCents: refund.amount,
                status: refund.status ?? "unknown",
                source: "charge.refunded",
              });
            }
          }
        }
        break;
      }

      case "charge.dispute.created":
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        const paymentIntentId =
          typeof dispute.payment_intent === "string" ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
        if (paymentIntentId) {
          const contribution = await prisma.contribution.findFirst({
            where: { organizationId, providerPaymentIntentId: paymentIntentId, stripeConnectedAccountId: connectedAccountId },
            select: { id: true },
          });
          if (contribution) {
            const { applyDisputeStatus } = await import("@/lib/giving/refunds");
            await applyDisputeStatus({ organizationId, providerPaymentIntentId: paymentIntentId, disputeStatus: dispute.status ?? "unknown" });
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        // CONNECT-D: subscriptions on connected accounts are giving-recurring
        // by construction today (SaaS billing never runs on a connected
        // account) — the metadata check guards against future connected
        // subscription types added in later CONNECT letters.
        const sub = event.data.object as Stripe.Subscription;
        if (sub.metadata?.paymentType === "giving-recurring") {
          const { syncScheduleFromSubscription } = await import("@/lib/giving/recurring");
          await syncScheduleFromSubscription({
            providerSubscriptionId: sub.id,
            providerStatus: sub.status,
            cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
            deleted: false,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.metadata?.paymentType === "giving-recurring") {
          const { syncScheduleFromSubscription } = await import("@/lib/giving/recurring");
          await syncScheduleFromSubscription({
            providerSubscriptionId: sub.id,
            providerStatus: sub.status,
            cancelAtPeriodEnd: false,
            deleted: true,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubscriptionId(invoice);
        if (subId) {
          // CONNECT-D (§16): failed voluntary giving is a schedule status,
          // NEVER a debt.
          const { markRecurringInvoiceFailed } = await import("@/lib/giving/recurring");
          await markRecurringInvoiceFailed({
            providerSubscriptionId: subId,
            requiresAction: invoice.status === "open" && Boolean((invoice as { payment_intent?: unknown }).payment_intent),
          });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoiceSubscriptionId(invoice);
        if (!subId && invoice.billing_reason?.startsWith("subscription")) {
          console.error(
            JSON.stringify({ event: "giving_recurring_invoice_missing_subscription_id", stripeInvoiceId: invoice.id })
          );
        }
        if (subId) {
          const { recordRecurringInvoicePaid } = await import("@/lib/giving/recurring");
          const result = await recordRecurringInvoicePaid({
            providerSubscriptionId: subId,
            providerInvoiceId: invoice.id,
            amountPaidCents: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? "usd",
            periodEnd: invoice.lines?.data?.[0]?.period?.end ?? null,
            paymentIntentId:
              typeof (invoice as { payment_intent?: unknown }).payment_intent === "string"
                ? ((invoice as { payment_intent?: string }).payment_intent ?? null)
                : null,
          });
          if (result.outcome === "REJECTED") {
            console.error(JSON.stringify({ event: "giving_recurring_invoice_connect_webhook_rejected", stripeInvoiceId: invoice.id }));
          }
        }
        break;
      }

      default:
        break;
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "stripe_connect_webhook_processing_failed",
        stripeEventType: event.type,
        stripeEventId: event.id,
        stripeAccountId: connectedAccountId,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return Response.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
