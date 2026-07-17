import "server-only";
import { prisma } from "@/lib/prisma";
import { PLANS, type PlanId } from "@/lib/plans";
import {
  normalizePagination,
  paginationResult,
  type Metric,
  type PagedResult,
  type PaginationInput,
} from "./types";

export interface BillingStatusSummary {
  active: number;
  trialing: number;
  pastDue: number;
  cancelled: number;
  unpaid: number;
}

export interface PlanDistributionEntry {
  plan: string;
  count: number;
}

export interface BillingSubscriptionRow {
  id: string;
  organizationId: string;
  organizationName: string;
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeDashboardUrl: string | null;
}

export interface BillingFilters {
  status?: string;
  plan?: string;
}

/** dashboard.stripe.com/customers/<id> is a stable, documented Stripe URL — safe to link to since we only ever populate it from an ID Stripe itself returned to us via createCustomer/webhook sync. */
function stripeDashboardUrl(stripeCustomerId: string | null): string | null {
  if (!stripeCustomerId) return null;
  return `https://dashboard.stripe.com/customers/${encodeURIComponent(stripeCustomerId)}`;
}

export async function listSubscriptions(
  filters: BillingFilters,
  pagination: PaginationInput
): Promise<PagedResult<BillingSubscriptionRow>> {
  const { page, pageSize } = normalizePagination(pagination);

  const where = {
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.plan ? { plan: filters.plan } : {}),
  };

  const [totalCount, rows] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        organizationId: true,
        organization: { select: { name: true, trialEndsAt: true } },
        plan: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      organizationName: r.organization.name,
      plan: r.plan,
      status: r.status,
      currentPeriodEnd: r.currentPeriodEnd?.toISOString() ?? null,
      trialEndsAt: r.organization.trialEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: r.cancelAtPeriodEnd,
      stripeCustomerId: r.stripeCustomerId,
      stripeSubscriptionId: r.stripeSubscriptionId,
      stripeDashboardUrl: stripeDashboardUrl(r.stripeCustomerId),
    })),
    pagination: paginationResult({ page, pageSize }, totalCount),
  };
}

export interface BillingOperationsSummary {
  statusSummary: BillingStatusSummary;
  planDistribution: PlanDistributionEntry[];
  trialsEndingSoon: { organizationId: string; organizationName: string; trialEndsAt: string }[];
  organizationsMissingStripeLinkage: { organizationId: string; organizationName: string; plan: string }[];
  recentInvoiceFailures: Metric<{ organizationId: string; organizationName: string; occurredAt: string }[]>;
  estimatedMrr: Metric<{ cents: number; subscriptionsCounted: number }>;
  stripeIntegrationHealth: Metric<{ configured: boolean }>;
}

async function estimateMrr(): Promise<Metric<{ cents: number; subscriptionsCounted: number }>> {
  const activeSubs = await prisma.subscription.findMany({
    where: { status: "active" },
    select: { plan: true, stripePriceId: true },
  });
  const yearlyPriceIds = new Set(
    Object.values(PLANS)
      .map((p) => p.yearlyPriceEnvKey && process.env[p.yearlyPriceEnvKey])
      .filter((v): v is string => Boolean(v))
  );
  let cents = 0;
  for (const sub of activeSubs) {
    const plan = PLANS[(sub.plan as PlanId)] ?? PLANS.essential;
    const isYearly = sub.stripePriceId ? yearlyPriceIds.has(sub.stripePriceId) : false;
    cents += isYearly ? Math.round(plan.yearlyPriceCents / 12) : plan.monthlyPriceCents;
  }
  return { status: "ok", value: { cents, subscriptionsCounted: activeSubs.length }, source: "derived", asOf: new Date().toISOString() };
}

export async function getBillingOperationsSummary(): Promise<BillingOperationsSummary> {
  const trialWindowEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const [
    active,
    trialing,
    pastDue,
    cancelled,
    unpaid,
    planGroups,
    trialsEndingSoon,
    paidOrgsWithoutSubscription,
    estimatedMrr,
  ] = await Promise.all([
    prisma.subscription.count({ where: { status: "active" } }),
    prisma.subscription.count({ where: { status: "trialing" } }),
    prisma.subscription.count({ where: { status: "past_due" } }),
    prisma.subscription.count({ where: { status: "cancelled" } }),
    prisma.subscription.count({ where: { status: "unpaid" } }),
    prisma.subscription.groupBy({ by: ["plan"], _count: { _all: true } }),
    prisma.organization.findMany({
      where: { trialEndsAt: { gte: new Date(), lte: trialWindowEnd } },
      select: { id: true, name: true, trialEndsAt: true },
      take: 100,
    }),
    prisma.organization.findMany({
      where: { plan: { in: ["essential", "elite"] }, subscriptions: { none: {} } },
      select: { id: true, name: true, plan: true },
      take: 100,
    }),
    estimateMrr(),
  ]);

  // No local record of individual invoice-payment failures exists (Stripe
  // invoice events aren't persisted, only subscription.status via the
  // webhook) — "past_due" subscriptions are the closest defensible proxy,
  // not the same thing, so this is reported as unavailable rather than
  // conflated with a real invoice-failure feed.
  const recentInvoiceFailures: Metric<{ organizationId: string; organizationName: string; occurredAt: string }[]> = {
    status: "not_configured",
    reason: "Individual Stripe invoice events are not persisted locally; use the Past Due filter as a proxy, or Stripe Dashboard for exact invoice history.",
  };

  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

  return {
    statusSummary: { active, trialing, pastDue, cancelled, unpaid },
    planDistribution: planGroups.map((g) => ({ plan: g.plan, count: g._count._all })),
    trialsEndingSoon: trialsEndingSoon.map((o) => ({
      organizationId: o.id,
      organizationName: o.name,
      trialEndsAt: o.trialEndsAt!.toISOString(),
    })),
    organizationsMissingStripeLinkage: paidOrgsWithoutSubscription.map((o) => ({
      organizationId: o.id,
      organizationName: o.name,
      plan: o.plan,
    })),
    recentInvoiceFailures,
    estimatedMrr,
    stripeIntegrationHealth: stripeConfigured
      ? { status: "ok", value: { configured: true }, source: "database", asOf: new Date().toISOString() }
      : { status: "not_configured", reason: "STRIPE_SECRET_KEY is not set" },
  };
}
