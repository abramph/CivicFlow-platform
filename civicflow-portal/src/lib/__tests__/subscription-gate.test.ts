import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrganization = vi.fn();
const findManySubscription = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    subscription: { findMany: (...args: unknown[]) => findManySubscription(...args) },
  },
}));

import { resolveOrganizationAccess, assertOrganizationAccess, SubscriptionRequiredError } from "@/lib/subscription-gate";

const NOW = new Date("2026-08-21T12:00:00.000Z");

describe("resolveOrganizationAccess — the canonical access decision", () => {
  beforeEach(() => {
    findUniqueOrganization.mockReset();
    findManySubscription.mockReset();
  });

  it("grants access to a billing-exempt organization regardless of trial/subscription state", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: true, trialEndsAt: null });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result).toEqual({ allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: true });
  });

  it("does not infer billing exemption from anything but the stored billingExempt column — a non-exempt org with an expired trial and zero subscriptions is denied even if it looks like a demo/reviewer org", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date("2026-08-12T00:00:00.000Z") });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.billingExempt).toBe(false);
  });

  it("grants access during an active internal trial", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date("2026-08-25T00:00:00.000Z") });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("denies access the instant trialEndsAt passes — no scheduled-job dependency, recomputed from the authoritative timestamp on every call", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date(NOW.getTime() - 1000) });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TRIAL_EXPIRED");
  });

  it("treats trialEndsAt exactly equal to now as expired (strict greater-than, not greater-or-equal)", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: NOW });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
  });

  it("E2E-2 boundary: still grants access one second before trialEndsAt", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date(NOW.getTime() + 1000) });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(true);
  });

  it("E2E-2 boundary: denies access one second after trialEndsAt", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date(NOW.getTime() - 1000) });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TRIAL_EXPIRED");
  });

  it("grants access when an ACTIVE subscription row exists, even after the trial has expired", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date("2026-08-12T00:00:00.000Z") });
    findManySubscription.mockResolvedValue([{ status: "active" }]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(true);
    expect(result.subscriptionStatus).toBe("active");
  });

  it("does NOT grant access merely because a Subscription row exists — past_due denies", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    findManySubscription.mockResolvedValue([{ status: "past_due" }]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SUBSCRIPTION_PAST_DUE");
  });

  it("denies a canceled subscription", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    findManySubscription.mockResolvedValue([{ status: "cancelled" }]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SUBSCRIPTION_CANCELED");
  });

  it("denies an unpaid/incomplete-style subscription", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    findManySubscription.mockResolvedValue([{ status: "unpaid" }]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SUBSCRIPTION_INCOMPLETE");
  });

  it("denies Stripe's own 'trialing' subscription status — Unestra never sets a Stripe trial period, so a real subscription observed in this state is never treated as active-equivalent", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    findManySubscription.mockResolvedValue([{ status: "trialing" }]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SUBSCRIPTION_INCOMPLETE");
  });

  it("falls back to SUBSCRIPTION_REQUIRED for an org with no trial and no subscription history at all", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("prefers the most recent subscription's status over a stale earlier one when picking the denial reason", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    // findMany is already ordered updatedAt desc in the real query — the mock
    // returns them in that same "most recent first" order.
    findManySubscription.mockResolvedValue([{ status: "cancelled" }, { status: "past_due" }]);

    const result = await resolveOrganizationAccess("org-1", NOW);

    expect(result.reason).toBe("SUBSCRIPTION_CANCELED");
  });

  it("denies access for a nonexistent organization rather than throwing", async () => {
    findUniqueOrganization.mockResolvedValue(null);
    findManySubscription.mockResolvedValue([]);

    const result = await resolveOrganizationAccess("org-missing", NOW);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("SUBSCRIPTION_REQUIRED");
  });
});

describe("assertOrganizationAccess — the throwing enforcement wrapper", () => {
  beforeEach(() => {
    findUniqueOrganization.mockReset();
    findManySubscription.mockReset();
  });

  it("resolves silently (no throw) when access is allowed", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: true, trialEndsAt: null });
    findManySubscription.mockResolvedValue([]);

    await expect(assertOrganizationAccess("org-1")).resolves.toMatchObject({ allowed: true });
  });

  it("throws a SubscriptionRequiredError carrying a 402 status and a safe, pre-approved message — no Stripe identifiers or internal billing detail", async () => {
    findUniqueOrganization.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date("2026-08-12T00:00:00.000Z") });
    findManySubscription.mockResolvedValue([]);

    const error = await assertOrganizationAccess("org-1").catch((e) => e);

    expect(error).toBeInstanceOf(SubscriptionRequiredError);
    expect(error.status).toBe(402);
    expect(error.code).toBe("ORGANIZATION_SUBSCRIPTION_REQUIRED");
    expect(error.reason).toBe("TRIAL_EXPIRED");
    expect(error.message).not.toMatch(/price_|sub_|cus_|sk_|rk_/);
  });
});
