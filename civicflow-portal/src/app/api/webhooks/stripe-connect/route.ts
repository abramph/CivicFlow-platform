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
