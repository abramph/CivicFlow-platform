import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionFindMany = vi.fn();
const subscriptionCount = vi.fn();
const subscriptionGroupBy = vi.fn();
const organizationFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: {
      findMany: (...args: unknown[]) => subscriptionFindMany(...args),
      count: (...args: unknown[]) => subscriptionCount(...args),
      groupBy: (...args: unknown[]) => subscriptionGroupBy(...args),
    },
    organization: { findMany: (...args: unknown[]) => organizationFindMany(...args) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  subscriptionCount.mockResolvedValue(0);
  subscriptionGroupBy.mockResolvedValue([]);
  organizationFindMany.mockResolvedValue([]);
  subscriptionFindMany.mockResolvedValue([]);
  delete process.env.STRIPE_PRICE_ESSENTIAL_YEARLY;
  delete process.env.STRIPE_PRICE_ELITE_YEARLY;
});

describe("getBillingOperationsSummary — estimated MRR", () => {
  it("is zero cents with zero subscriptions counted when there are no active subscriptions", async () => {
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.estimatedMrr).toEqual({
      status: "ok",
      value: { cents: 0, subscriptionsCounted: 0 },
      source: "derived",
      asOf: expect.any(String),
    });
  });

  it("sums monthly-plan prices directly (essential $49 = 4900 cents)", async () => {
    subscriptionFindMany.mockResolvedValueOnce([{ plan: "essential", stripePriceId: "price_monthly_1" }]);
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.estimatedMrr.status).toBe("ok");
    if (summary.estimatedMrr.status === "ok") {
      expect(summary.estimatedMrr.value.cents).toBe(4900);
      expect(summary.estimatedMrr.value.subscriptionsCounted).toBe(1);
    }
  });

  it("normalizes a yearly-plan subscription to a monthly-equivalent (÷12)", async () => {
    process.env.STRIPE_PRICE_ESSENTIAL_YEARLY = "price_yearly_essential";
    subscriptionFindMany.mockResolvedValueOnce([{ plan: "essential", stripePriceId: "price_yearly_essential" }]);
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.estimatedMrr.status).toBe("ok");
    if (summary.estimatedMrr.status === "ok") {
      // 53900 / 12, rounded
      expect(summary.estimatedMrr.value.cents).toBe(Math.round(53900 / 12));
    }
  });

  it("only counts subscriptions with status active — trialing/past_due/cancelled contribute nothing", async () => {
    // findMany is called with `where: { status: "active" }` — simulate the
    // DB-level filter by returning empty when the query wasn't for active status.
    subscriptionFindMany.mockImplementationOnce((args: { where?: { status?: string } }) => {
      return args?.where?.status === "active" ? Promise.resolve([]) : Promise.resolve([{ plan: "elite", stripePriceId: null }]);
    });
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.estimatedMrr.status).toBe("ok");
    if (summary.estimatedMrr.status === "ok") {
      expect(summary.estimatedMrr.value.subscriptionsCounted).toBe(0);
    }
  });
});

describe("getBillingOperationsSummary — billing-exempt organizations", () => {
  it("excludes billing-exempt organizations from the estimated-MRR query", async () => {
    const { getBillingOperationsSummary } = await import("../billing");
    await getBillingOperationsSummary();
    const call = subscriptionFindMany.mock.calls[0]?.[0] as { where?: { organization?: { billingExempt?: boolean } } };
    expect(call.where?.organization?.billingExempt).toBe(false);
  });

  it("excludes billing-exempt organizations from the missing-Stripe-linkage query", async () => {
    const { getBillingOperationsSummary } = await import("../billing");
    await getBillingOperationsSummary();
    const linkageCall = organizationFindMany.mock.calls.find(
      (call) => (call[0] as { where?: { subscriptions?: unknown } })?.where?.subscriptions
    )?.[0] as { where?: { billingExempt?: boolean } };
    expect(linkageCall?.where?.billingExempt).toBe(false);
  });

  it("excludes billing-exempt organizations from the trials-ending-soon query", async () => {
    const { getBillingOperationsSummary } = await import("../billing");
    await getBillingOperationsSummary();
    const trialCall = organizationFindMany.mock.calls.find(
      (call) => (call[0] as { where?: { trialEndsAt?: unknown } })?.where?.trialEndsAt
    )?.[0] as { where?: { billingExempt?: boolean } };
    expect(trialCall?.where?.billingExempt).toBe(false);
  });
});

describe("getBillingOperationsSummary — Stripe integration health", () => {
  it("reports not_configured when STRIPE_SECRET_KEY is unset", async () => {
    const original = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.stripeIntegrationHealth.status).toBe("not_configured");
    if (original) process.env.STRIPE_SECRET_KEY = original;
  });

  it("reports ok (configured) when STRIPE_SECRET_KEY is set — without making a live Stripe call", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.stripeIntegrationHealth.status).toBe("ok");
  });
});

describe("getBillingOperationsSummary — missing Stripe linkage", () => {
  it("flags a paid-plan organization with zero Subscription rows", async () => {
    organizationFindMany.mockImplementation((args: { where?: { subscriptions?: unknown } }) => {
      if (args?.where?.subscriptions) {
        return Promise.resolve([{ id: "org-1", name: "Paid No Sub", plan: "essential" }]);
      }
      return Promise.resolve([]);
    });
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.organizationsMissingStripeLinkage).toEqual([{ organizationId: "org-1", organizationName: "Paid No Sub", plan: "essential" }]);
  });
});

describe("getBillingOperationsSummary — recent invoice failures", () => {
  it("is honestly reported as not_configured — individual Stripe invoice events aren't persisted locally", async () => {
    const { getBillingOperationsSummary } = await import("../billing");
    const summary = await getBillingOperationsSummary();
    expect(summary.recentInvoiceFailures.status).toBe("not_configured");
  });
});
