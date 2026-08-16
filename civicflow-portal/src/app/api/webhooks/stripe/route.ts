import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { createAuditEvent } from "@/lib/audit";
import { requireRateLimit } from "@/lib/rate-limit";
import { planFromPriceId, isSeatPriceId, isSmsAddOnPriceId } from "@/lib/stripe";
import { getPlan } from "@/lib/plans";
import { SMS_ADDON } from "@/lib/sms-pricing";
import { recordDuesPayment } from "@/lib/dues-payments";
import type { SubscriptionStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripeClient() {
  const env = getServerEnv();
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  if (status === "active")   return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due") return "past_due";
  if (status === "unpaid")   return "unpaid";
  return "cancelled";
}

async function resolveOrgId(
  sub: Stripe.Subscription
): Promise<string | null> {
  if (sub.metadata?.organizationId) return sub.metadata.organizationId;
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
  if (!stripeCustomerId) return null;
  const existing = await prisma.subscription.findFirst({
    where: { stripeCustomerId },
    select: { organizationId: true },
  });
  return existing?.organizationId ?? null;
}

async function upsertSubscriptionFromStripe(
  sub: Stripe.Subscription,
  orgIdOverride?: string
) {
  const orgId = orgIdOverride ?? (await resolveOrgId(sub));
  if (!orgId) return null;

  const stripeCustomerId =
    typeof sub.customer === "string" ? sub.customer : null;

  let priceId: string | null = null;
  let additionalSeats = 0;
  for (const item of sub.items.data) {
    const pid = item.price?.id;
    if (!pid) continue;
    if (isSeatPriceId(pid)) {
      additionalSeats += item.quantity ?? 0;
    } else if (!priceId) {
      priceId = pid;
    }
  }

  const plan = (priceId ? planFromPriceId(priceId) : null) ?? "essential";
  const planConfig = getPlan(plan);
  const seatLimit = planConfig.includedSeats + additionalSeats;
  const status = mapSubscriptionStatus(sub.status);
  const isActive = sub.status === "active" || sub.status === "trialing";

  const record = await prisma.subscription.upsert({
    where: { stripeSubscriptionId: sub.id },
    create: {
      organizationId: orgId,
      stripeCustomerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      plan,
      status,
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000)
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    },
    update: {
      stripeCustomerId,
      stripePriceId: priceId,
      plan,
      status,
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000)
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    },
  });

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      plan: isActive ? plan : "free",
      ...(isActive ? { seatLimit } : { seatLimit: null }),
    },
  });

  // Keep the SMS add-on entitlement in sync with Stripe's own truth, even if
  // it was added/removed directly in the Stripe dashboard rather than
  // through our /api/billing/sms-addon button.
  const smsAddOnItem = sub.items.data.find((item) => item.price?.id && isSmsAddOnPriceId(item.price.id));
  const currentPeriodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000) : null;
  const currentPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
  const existingSmsSettings = await prisma.organizationSmsSettings.findUnique({ where: { organizationId: orgId } });
  const periodRolledOver =
    !existingSmsSettings?.smsBillingPeriodStart ||
    (currentPeriodStart && existingSmsSettings.smsBillingPeriodStart.getTime() !== currentPeriodStart.getTime());

  await prisma.organizationSmsSettings.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      smsAddOnActive: Boolean(smsAddOnItem),
      smsMonthlyLimit: smsAddOnItem ? SMS_ADDON.includedMessagesPerMonth : 0,
      smsOverageRateCents: SMS_ADDON.overageRateCents,
      smsBillingPeriodStart: currentPeriodStart,
      smsBillingPeriodEnd: currentPeriodEnd,
      stripeSmsSubscriptionItemId: smsAddOnItem?.id ?? null,
    },
    update: {
      smsAddOnActive: Boolean(smsAddOnItem),
      smsMonthlyLimit: smsAddOnItem ? SMS_ADDON.includedMessagesPerMonth : (existingSmsSettings?.smsMonthlyLimit ?? 0),
      stripeSmsSubscriptionItemId: smsAddOnItem?.id ?? null,
      ...(periodRolledOver
        ? { smsUsedThisPeriod: 0, smsBillingPeriodStart: currentPeriodStart, smsBillingPeriodEnd: currentPeriodEnd }
        : {}),
    },
  });

  return { orgId, record };
}

export async function POST(request: Request) {
  const rateLimited = await requireRateLimit({
    scope: "api:webhooks:stripe",
    request,
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const env = getServerEnv();
  const stripe = getStripeClient();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ ok: false, error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // CONNECT-G: this used to fail SILENTLY — a stale secret produced a
    // steady stream of 400s with no trace anywhere. Never log the body or
    // signature header (may embed sensitive payload fragments); the error
    // message from Stripe's SDK is safe (verification-failure reason only).
    console.error(
      JSON.stringify({
        event: "stripe_webhook_signature_invalid",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return Response.json({ ok: false, error: "Invalid Stripe signature" }, { status: 400 });
  }

  // Idempotency guard: Stripe may redeliver the same event. Insert a row
  // keyed by event.id before processing; a unique-constraint violation means
  // this event was already handled, so skip re-processing side effects.
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
        const orgId = session.metadata?.organizationId;

        // CORE-GIVE-D: setup-mode session completing a payment-method update.
        if (session.mode === "setup" && session.metadata?.paymentType === "giving-method-update") {
          const setupIntentId =
            typeof session.setup_intent === "string" ? session.setup_intent : (session.setup_intent?.id ?? null);
          if (orgId && session.metadata?.scheduleId && setupIntentId) {
            const { applyPaymentMethodUpdate } = await import("@/lib/giving/recurring-self-service");
            const applied = await applyPaymentMethodUpdate({
              organizationId: orgId,
              scheduleId: session.metadata.scheduleId,
              setupIntentId,
            });
            if (applied === "REJECTED") {
              console.error(JSON.stringify({ event: "giving_pm_update_rejected", sessionId: session.id, orgId }));
            }
          }
          break;
        }

        // CORE-GIVE-C: a giving-recurring checkout is MEMBER MONEY — it must
        // never be upserted into the SaaS Subscription table. Link it to our
        // schedule (resolved org-scoped: the §50 cross-check) instead.
        //
        // CONNECT-D: new recurring giving checkout sessions are now created
        // against the org's connected account (see
        // src/app/api/giving/recurring/checkout/route.ts), so their events
        // arrive on /api/webhooks/stripe-connect instead, which has its own
        // copy of this branch. UNLIKE CONNECT-C's one-time/public giving
        // (where the audit proved zero real platform-account transactions
        // existed), this branch is kept here rather than removed — it
        // remains the only path for any recurring schedule that was already
        // running on the platform account before CONNECT-D shipped.
        if (session.metadata?.paymentType === "giving-recurring") {
          if (session.subscription && orgId && session.metadata?.scheduleId) {
            const subId =
              typeof session.subscription === "string" ? session.subscription : session.subscription.id;
            const { linkScheduleFromCheckout } = await import("@/lib/giving/recurring");
            const linked = await linkScheduleFromCheckout({
              scheduleId: session.metadata.scheduleId,
              organizationId: orgId,
              providerSubscriptionId: subId,
              providerCustomerId: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
            });
            if (linked === "REJECTED") {
              console.error(JSON.stringify({ event: "giving_recurring_link_rejected", sessionId: session.id, orgId }));
            }
            await createAuditEvent({
              organizationId: orgId,
              action: "update",
              entityType: "stripe_webhook",
              entityId: session.id,
              metadata: { eventType: event.type, givingRecurring: true, outcome: linked },
            });
          }
          break;
        }

        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(sub, orgId ?? undefined);
        }

        // CONNECT-C: one-time member Giving and public Giving now create
        // their checkout sessions against the organization's OWN connected
        // account (direct charges — see src/app/api/giving/checkout/route.ts
        // and src/app/api/public/give/route.ts). Their
        // checkout.session.completed events therefore arrive ONLY on
        // /api/webhooks/stripe-connect (subscribed to "Events on connected
        // accounts"), never here (this endpoint is "Events on your account"
        // only) — the paymentType === "giving" / "public-giving" branches
        // that used to live here were removed rather than left as dead code.
        // See docs/stripe-connect-architecture.md's CONNECT-C entry.

        // Record a Contribution (or, for dues, a DuesPayment applied to the
        // member's balance) when a payment link checkout completes.
        const paymentLinkId = session.metadata?.paymentLinkId;
        const paymentType = session.metadata?.paymentType || null;
        const payingMemberId = session.metadata?.memberId || null;

        if (paymentLinkId && orgId && session.payment_status === "paid") {
          const amountTotal = session.amount_total ?? 0;
          const amountDollars = amountTotal / 100;

          if (paymentType === "dues" && payingMemberId) {
            // Re-resolve the oldest outstanding charge now (not at
            // checkout-session creation time) — it may have already been
            // paid through another channel in the interim, exactly like the
            // payment-report approval flow (src/app/api/admin/payment-reports/
            // [id]/approve/route.ts) re-queries at approval time rather than
            // trusting a possibly-stale charge reference.
            const charge = await prisma.duesCharge.findFirst({
              where: { organizationId: orgId, memberId: payingMemberId, status: { in: ["PENDING", "PARTIAL"] } },
              orderBy: [{ dueDate: "asc" }],
            });

            await recordDuesPayment({
              organizationId: orgId,
              memberId: payingMemberId,
              duesChargeId: charge?.id ?? null,
              amount: amountDollars,
              paymentDate: new Date(),
              method: "STRIPE",
              reference: session.id,
              notes: `Paid by card via payment link ${paymentLinkId}`,
              charge,
            });
          } else {
            const campaignId = session.metadata?.campaignId || null;
            const eventId = session.metadata?.eventId || null;
            const contributorName = session.metadata?.contributorName || null;
            const contributorEmail =
              typeof session.customer_details?.email === "string"
                ? session.customer_details.email
                : null;

            await prisma.contribution.create({
              data: {
                organizationId: orgId,
                amount: amountDollars,
                contributionDate: new Date(),
                paymentMethod: "STRIPE",
                source: campaignId ? "CAMPAIGN_PAGE" : eventId ? "EVENT_PAGE" : "MANUAL",
                campaignId: campaignId || null,
                eventId: eventId || null,
                contributorName:
                  contributorName ||
                  (contributorEmail ? contributorEmail : null),
                notes: `Payment link: ${paymentLinkId}`,
                receiptRequested: Boolean(contributorEmail),
              },
            });
          }

          await prisma.paymentLink.update({
            where: { id: paymentLinkId },
            data: { useCount: { increment: 1 } },
          });
        }

        if (orgId) {
          await createAuditEvent({
            organizationId: orgId,
            action: "update",
            entityType: "stripe_webhook",
            entityId: session.id,
            metadata: { eventType: event.type, paymentLinkId: paymentLinkId ?? null },
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        // CORE-GIVE-C: giving subscriptions mirror onto the schedule and must
        // never create/patch a SaaS Subscription row.
        if (sub.metadata?.paymentType === "giving-recurring") {
          const { syncScheduleFromSubscription } = await import("@/lib/giving/recurring");
          await syncScheduleFromSubscription({
            providerSubscriptionId: sub.id,
            providerStatus: sub.status,
            cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
            deleted: false,
          });
          break;
        }
        const mapped = await upsertSubscriptionFromStripe(sub);
        if (mapped) {
          await createAuditEvent({
            organizationId: mapped.orgId,
            action: "update",
            entityType: "subscription",
            entityId: mapped.record.id,
            metadata: { eventType: event.type, stripeSubscriptionId: sub.id, status: mapped.record.status },
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
          break;
        }
        const orgId = await resolveOrgId(sub);

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { status: "cancelled", cancelAtPeriodEnd: false },
        });

        if (orgId) {
          await prisma.organization.update({
            where: { id: orgId },
            data: { plan: "free" },
          });
          await prisma.organizationSmsSettings.updateMany({
            where: { organizationId: orgId },
            data: { smsAddOnActive: false, stripeSmsSubscriptionItemId: null },
          });
          await createAuditEvent({
            organizationId: orgId,
            action: "update",
            entityType: "subscription",
            entityId: sub.id,
            metadata: { eventType: event.type, stripeSubscriptionId: sub.id },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : null;
        if (subId) {
          // CORE-GIVE-C: failed voluntary giving is a schedule status, NEVER
          // a debt (§16) — and never a SaaS past_due.
          const { markRecurringInvoiceFailed } = await import("@/lib/giving/recurring");
          const givingOutcome = await markRecurringInvoiceFailed({
            providerSubscriptionId: subId,
            requiresAction: invoice.status === "open" && Boolean((invoice as { payment_intent?: unknown }).payment_intent),
          });
          if (givingOutcome === "MARKED") break;
        }
        if (subId) {
          await prisma.subscription.updateMany({
            where: { stripeSubscriptionId: subId },
            data: { status: "past_due" },
          });
          // No PII — Stripe ids and cents only, never card/customer details.
          console.warn(
            JSON.stringify({
              event: "stripe_invoice_payment_failed",
              stripeSubscriptionId: subId,
              stripeInvoiceId: invoice.id,
              amountDue: invoice.amount_due,
            })
          );
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : null;
        if (subId) {
          // CORE-GIVE-C: recurring giving invoice → durable Contribution,
          // idempotent on the invoice id; the schedule is resolved by OUR
          // unique providerSubscriptionId, never by trusting metadata.
          const { recordRecurringInvoicePaid } = await import("@/lib/giving/recurring");
          const givingResult = await recordRecurringInvoicePaid({
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
          if (givingResult.outcome !== "NOT_GIVING") {
            if (givingResult.outcome === "REJECTED") {
              console.error(JSON.stringify({ event: "giving_invoice_rejected", stripeInvoiceId: invoice.id }));
            }
            break;
          }
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(sub);
        }
        break;
      }

      case "charge.refunded": {
        // CORE-GIVE-K (§34): provider-truth refund state. The charge's
        // payment intent locates OUR contribution; org comes from the
        // contribution row itself, never from unverified metadata.
        //
        // The event payload's own `charge.refunds` is expand-only and comes
        // back EMPTY on our real webhook delivery (confirmed against a live
        // test-mode charge, 2026-08) — Stripe's own docs say as much:
        // "Listen to refund.created for information about the refund."
        // Rather than fall back to a synthetic charge-derived id (which
        // can't distinguish two different refunds on the same charge — the
        // exact bug this replaces), re-fetch the charge with an explicit
        // expand so every refund is applied under its OWN real `refund.id`.
        // applyProviderRefund's unique constraint makes re-processing
        // already-applied refunds on every charge.refunded delivery a safe
        // no-op, so this is also naturally replay- and reorder-safe.
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
        if (paymentIntentId) {
          const contribution = await prisma.contribution.findFirst({
            where: { providerPaymentIntentId: paymentIntentId },
            select: { organizationId: true },
          });
          if (contribution) {
            const fullCharge = await stripe.charges.retrieve(charge.id, { expand: ["refunds"] });
            const { applyProviderRefund } = await import("@/lib/giving/refunds");
            for (const refund of fullCharge.refunds?.data ?? []) {
              await applyProviderRefund({
                organizationId: contribution.organizationId,
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
        // CORE-GIVE-K (§35): mirror the provider's dispute state; the row
        // is never hidden or removed.
        const dispute = event.data.object as Stripe.Dispute;
        const paymentIntentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : (dispute.payment_intent?.id ?? null);
        if (paymentIntentId) {
          const contribution = await prisma.contribution.findFirst({
            where: { providerPaymentIntentId: paymentIntentId },
            select: { organizationId: true },
          });
          if (contribution) {
            const { applyDisputeStatus } = await import("@/lib/giving/refunds");
            await applyDisputeStatus({
              organizationId: contribution.organizationId,
              providerPaymentIntentId: paymentIntentId,
              disputeStatus: dispute.status ?? "unknown",
            });
          }
        }
        break;
      }

      default:
        break;
    }

    return Response.json({ ok: true });
  } catch (error) {
    // No PII — Stripe's own event type/id and the error message only, never
    // the raw event payload (which can carry customer/card details).
    console.error(
      JSON.stringify({
        event: "stripe_webhook_processing_failed",
        stripeEventType: event.type,
        stripeEventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return Response.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
