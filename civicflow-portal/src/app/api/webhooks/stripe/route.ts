import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { createAuditEvent } from "@/lib/audit";
import { requireRateLimit } from "@/lib/rate-limit";
import { planFromPriceId } from "@/lib/stripe";
import type { SubscriptionStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripeClient() {
  const env = getServerEnv();
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-05-28.basil" });
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
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const plan = (priceId ? planFromPriceId(priceId) : null) ?? "essential";
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

  // Only update org.plan — never touch org.status from billing events
  await prisma.organization.update({
    where: { id: orgId },
    data: { plan: isActive ? plan : "free" },
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
  } catch {
    return Response.json({ ok: false, error: "Invalid Stripe signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.organizationId;

        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(sub, orgId ?? undefined);
        }

        if (orgId) {
          await createAuditEvent({
            organizationId: orgId,
            action: "update",
            entityType: "stripe_webhook",
            entityId: session.id,
            metadata: { eventType: event.type },
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
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
          await prisma.subscription.updateMany({
            where: { stripeSubscriptionId: subId },
            data: { status: "past_due" },
          });
        }
        break;
      }

      default:
        break;
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
