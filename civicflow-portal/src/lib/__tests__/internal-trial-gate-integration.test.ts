import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves grantInternalOrganizationTrial() and resolveOrganizationAccess()
 * (subscription-gate.ts, UNCHANGED by this feature) actually compose
 * correctly, end to end, through the one field they share — trialEndsAt —
 * rather than relying on inference from each file's own separate test
 * suite. No special-case/bypass code exists anywhere for this: the gate
 * simply reads the same column the grant service writes.
 */

const organizationFindUnique = vi.fn();
const organizationUpdateMany = vi.fn();
const subscriptionCount = vi.fn();
const subscriptionFindMany = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUnique(...args),
      updateMany: (...args: unknown[]) => organizationUpdateMany(...args),
    },
    subscription: {
      count: (...args: unknown[]) => subscriptionCount(...args),
      findMany: (...args: unknown[]) => subscriptionFindMany(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEvent: vi.fn().mockResolvedValue({ id: "audit-1" }),
}));

import { grantInternalOrganizationTrial, INTERNAL_TRIAL_DURATION_DAYS } from "@/lib/platform-operations/internal-trial";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";

const NOW = new Date("2026-08-30T12:00:00.000Z");

beforeEach(() => {
  organizationFindUnique.mockReset();
  organizationUpdateMany.mockReset();
  subscriptionCount.mockReset();
  subscriptionFindMany.mockReset();
  transactionMock.mockReset();
  transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      organization: { findUnique: organizationFindUnique, updateMany: organizationUpdateMany },
      subscription: { count: subscriptionCount },
    })
  );
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("internal trial grant → subscription gate, end to end", () => {
  it("an org denied by the gate before the grant is allowed immediately after, using only trialEndsAt — no other field changes", async () => {
    // Before: gate denies (matches Pine Grove's real pre-grant shape).
    organizationFindUnique.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    subscriptionFindMany.mockResolvedValue([]);
    const before = await resolveOrganizationAccess("org-1", NOW);
    expect(before.allowed).toBe(false);
    expect(before.reason).toBe("SUBSCRIPTION_REQUIRED");

    // Grant: capture the exact trialExpiresAt the service computes.
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(0);
    organizationUpdateMany.mockResolvedValue({ count: 1 });
    const grant = await grantInternalOrganizationTrial({
      organizationId: "org-1",
      actorUserId: "admin-1",
      actorEmail: "admin@aphtechnologies.example",
      actorRole: "SUPER_ADMIN",
      reason: "test",
    });

    // After: feed that exact trialEndsAt back into the gate.
    organizationFindUnique.mockResolvedValue({ billingExempt: false, trialEndsAt: new Date(grant.trialExpiresAt) });
    subscriptionFindMany.mockResolvedValue([]);
    const during = await resolveOrganizationAccess("org-1", NOW);
    expect(during.allowed).toBe(true);
    expect(during.reason).toBeNull();
    expect(during.billingExempt).toBe(false); // access via trial, not via billing exemption

    // After expiration (30 days + 1ms later): denied again, automatically.
    const justAfterExpiry = new Date(NOW.getTime() + INTERNAL_TRIAL_DURATION_DAYS * 86_400_000 + 1);
    const after = await resolveOrganizationAccess("org-1", justAfterExpiry);
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe("TRIAL_EXPIRED");
  });

  it("a billing-exempt org's gate outcome is unaffected by this feature — the grant service rejects it before any write is attempted", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: true, trialEndsAt: null });
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "a", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_BILLING_EXEMPT" });
    expect(organizationUpdateMany).not.toHaveBeenCalled();

    // Gate check for the same org is untouched — billing exemption alone still grants access, same as before this feature existed.
    organizationFindUnique.mockResolvedValue({ billingExempt: true, trialEndsAt: null });
    subscriptionFindMany.mockResolvedValue([]);
    const result = await resolveOrganizationAccess("org-1", NOW);
    expect(result.allowed).toBe(true);
    expect(result.billingExempt).toBe(true);
  });

  it("an org with an active real Subscription is unaffected — the grant service rejects it, and the gate already granted access via the subscription, not a trial", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(1);
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "a", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_HAS_SUBSCRIPTION" });

    organizationFindUnique.mockResolvedValue({ billingExempt: false, trialEndsAt: null });
    subscriptionFindMany.mockResolvedValue([{ status: "active" }]);
    const result = await resolveOrganizationAccess("org-1", NOW);
    expect(result.allowed).toBe(true);
    expect(result.subscriptionStatus).toBe("active");
  });
});
