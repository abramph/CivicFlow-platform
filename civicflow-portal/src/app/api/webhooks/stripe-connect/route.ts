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
  } catch {
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
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

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
            const amountDollars = amountTotal / 100;

            if (linkPaymentType === "dues" && payingMemberId) {
              const charge = await prisma.duesCharge.findFirst({
                where: { organizationId, memberId: payingMemberId, status: { in: ["PENDING", "PARTIAL"] } },
                orderBy: [{ dueDate: "asc" }],
              });

              const { recordDuesPayment } = await import("@/lib/dues-payments");
              await recordDuesPayment({
                organizationId,
                memberId: payingMemberId,
                duesChargeId: charge?.id ?? null,
                amount: amountDollars,
                paymentDate: new Date(),
                method: "STRIPE",
                reference: session.id,
                notes: `Paid by card via payment link ${paymentLinkId}`,
                stripeConnectedAccountId: connectedAccountId,
                providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
                charge,
              });
            } else {
              const campaignId = session.metadata?.campaignId || null;
              const eventId = session.metadata?.eventId || null;
              const contributorName = session.metadata?.contributorName || null;
              const contributorEmail =
                typeof session.customer_details?.email === "string" ? session.customer_details.email : null;

              await prisma.contribution.create({
                data: {
                  organizationId,
                  amount: amountDollars,
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
          }
        }

        break;
      }

      case "charge.refunded": {
        // CORE-GIVE-K / CONNECT-C (§17): the charge's payment intent locates
        // OUR contribution, scoped to both the resolved org AND the resolved
        // connected account — a refund event can only apply to a
        // contribution that was actually charged on that same account.
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId =
          typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
        if (paymentIntentId) {
          const refundList = (charge as { refunds?: { data?: { id: string }[] } }).refunds?.data ?? [];
          const latestRefundId = refundList[0]?.id ?? `charge-${charge.id}`;
          const contribution = await prisma.contribution.findFirst({
            where: { organizationId, providerPaymentIntentId: paymentIntentId, stripeConnectedAccountId: connectedAccountId },
            select: { id: true },
          });
          if (contribution) {
            const { applyProviderRefund } = await import("@/lib/giving/refunds");
            await applyProviderRefund({
              organizationId,
              providerPaymentIntentId: paymentIntentId,
              providerRefundId: latestRefundId,
              amountRefundedCents: charge.amount_refunded ?? 0,
              mode: "cumulative",
            });
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
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : null;
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
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : null;
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
