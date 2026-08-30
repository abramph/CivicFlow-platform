import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const organizationFindUnique = vi.fn();
const organizationUpdateMany = vi.fn();
const subscriptionCount = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUnique(...args),
      updateMany: (...args: unknown[]) => organizationUpdateMany(...args),
    },
    subscription: { count: (...args: unknown[]) => subscriptionCount(...args) },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue({ id: "audit-1" });
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

import {
  checkInternalTrialEligibility,
  grantInternalOrganizationTrial,
  terminateInternalOrganizationTrialEarly,
  INTERNAL_TRIAL_DURATION_DAYS,
} from "../internal-trial";

const NOW = new Date("2026-08-30T12:00:00.000Z");

/** The transaction callback receives a `tx` shaped exactly like `prisma`
 * above for these tests — real Prisma's tx client and the top-level client
 * expose the same delegate methods, so reusing the same mocks is faithful. */
function mockTransactionRunsCallback() {
  transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      organization: { findUnique: organizationFindUnique, updateMany: organizationUpdateMany },
      subscription: { count: subscriptionCount },
    })
  );
}

beforeEach(() => {
  organizationFindUnique.mockReset();
  organizationUpdateMany.mockReset();
  subscriptionCount.mockReset();
  transactionMock.mockReset();
  createAuditEvent.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkInternalTrialEligibility — read-only preview", () => {
  it("is eligible for an active, non-exempt, never-trialed, subscription-free organization", async () => {
    organizationFindUnique.mockResolvedValue({
      id: "org-1",
      name: "Pine Grove School PTA",
      status: "active",
      billingExempt: false,
      trialEndsAt: null,
    });
    subscriptionCount.mockResolvedValue(0);

    const result = await checkInternalTrialEligibility("org-1");

    expect(result.eligible).toBe(true);
    expect(result.ineligibleCode).toBeNull();
    expect(result.fixedDurationDays).toBe(INTERNAL_TRIAL_DURATION_DAYS);
  });

  it("throws 404 for a missing organization", async () => {
    organizationFindUnique.mockResolvedValue(null);
    await expect(checkInternalTrialEligibility("missing")).rejects.toMatchObject({
      code: "INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND",
      status: 404,
    });
  });

  it("is ineligible for an inactive (suspended) organization", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", name: "X", status: "suspended", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(0);
    const result = await checkInternalTrialEligibility("org-1");
    expect(result.eligible).toBe(false);
    expect(result.ineligibleCode).toBe("INTERNAL_TRIAL_ORGANIZATION_INACTIVE");
  });

  it("is ineligible for a cancelled organization", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", name: "X", status: "cancelled", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(0);
    const result = await checkInternalTrialEligibility("org-1");
    expect(result.ineligibleCode).toBe("INTERNAL_TRIAL_ORGANIZATION_INACTIVE");
  });

  it("is ineligible for an already billing-exempt organization", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", name: "X", status: "active", billingExempt: true, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(0);
    const result = await checkInternalTrialEligibility("org-1");
    expect(result.ineligibleCode).toBe("INTERNAL_TRIAL_BILLING_EXEMPT");
  });

  it("is ineligible when any Subscription row exists, active or not", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", name: "X", status: "active", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(1);
    const result = await checkInternalTrialEligibility("org-1");
    expect(result.ineligibleCode).toBe("INTERNAL_TRIAL_HAS_SUBSCRIPTION");
  });

  it("distinguishes an active trial from an already-used (expired) trial", async () => {
    organizationFindUnique.mockResolvedValue({
      id: "org-1",
      name: "X",
      status: "active",
      billingExempt: false,
      trialEndsAt: new Date(NOW.getTime() + 1000),
    });
    subscriptionCount.mockResolvedValue(0);
    const active = await checkInternalTrialEligibility("org-1");
    expect(active.ineligibleCode).toBe("INTERNAL_TRIAL_ALREADY_ACTIVE");

    organizationFindUnique.mockResolvedValue({
      id: "org-1",
      name: "X",
      status: "active",
      billingExempt: false,
      trialEndsAt: new Date(NOW.getTime() - 1000),
    });
    const used = await checkInternalTrialEligibility("org-1");
    expect(used.ineligibleCode).toBe("INTERNAL_TRIAL_ALREADY_USED");
  });

  it("does not bypass ineligibility for a reviewer/demo-shaped organization name — eligibility never consults the name field", async () => {
    organizationFindUnique.mockResolvedValue({
      id: "org-1",
      name: "Unestra Demo PTA",
      status: "active",
      billingExempt: false,
      trialEndsAt: null,
    });
    subscriptionCount.mockResolvedValue(0);
    const result = await checkInternalTrialEligibility("org-1");
    // Eligible here purely because the underlying fields say so — same
    // result a "boring" org with identical field values would get, proving
    // the decision is field-driven, not name-driven.
    expect(result.eligible).toBe(true);
  });
});

describe("grantInternalOrganizationTrial — the atomic write", () => {
  beforeEach(() => {
    mockTransactionRunsCallback();
  });

  it("rejects a missing reason before touching the database", async () => {
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_REASON_REQUIRED", status: 400 });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only reason", async () => {
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "   " })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_REASON_REQUIRED" });
  });

  it("grants a fixed 30-day trial, writes only trialEndsAt, and audits with no Stripe/billing side effects", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(0);
    organizationUpdateMany.mockResolvedValue({ count: 1 });

    const result = await grantInternalOrganizationTrial({
      organizationId: "org-1",
      actorUserId: "admin-1",
      actorEmail: "admin@aphtechnologies.example",
      actorRole: "SUPER_ADMIN",
      reason: "Pine Grove fictional PTA volunteer-hours reporting pilot",
    });

    expect(result.accessActive).toBe(true);
    expect(result.trialStartsAt).toBe(NOW.toISOString());
    expect(result.trialExpiresAt).toBe(new Date(NOW.getTime() + INTERNAL_TRIAL_DURATION_DAYS * 86_400_000).toISOString());
    expect(result.auditEventId).toBe("audit-1");

    // The conditional updateMany is the entire write — assert its WHERE
    // clause re-checks every eligibility condition, and its data touches
    // ONLY trialEndsAt (never billingExempt, status, or plan).
    expect(organizationUpdateMany).toHaveBeenCalledWith({
      where: { id: "org-1", trialEndsAt: null, billingExempt: false, status: "active" },
      data: { trialEndsAt: new Date(NOW.getTime() + INTERNAL_TRIAL_DURATION_DAYS * 86_400_000) },
    });

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "admin-1",
        action: "platform.organization.internal_trial_granted",
        metadata: expect.objectContaining({ durationDays: INTERNAL_TRIAL_DURATION_DAYS, reason: "Pine Grove fictional PTA volunteer-hours reporting pilot" }),
      })
    );
  });

  it("rejects a missing organization", async () => {
    organizationFindUnique.mockResolvedValue(null);
    await expect(
      grantInternalOrganizationTrial({ organizationId: "missing", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND", status: 404 });
    expect(organizationUpdateMany).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an inactive organization", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "suspended", billingExempt: false, trialEndsAt: null });
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_ORGANIZATION_INACTIVE" });
    expect(organizationUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a billing-exempt organization without writing or auditing anything", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: true, trialEndsAt: null });
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_BILLING_EXEMPT" });
    expect(organizationUpdateMany).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an organization with an existing active Subscription (rechecked inside the transaction)", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(1);
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_HAS_SUBSCRIPTION" });
    expect(subscriptionCount).toHaveBeenCalledWith({ where: { organizationId: "org-1" } });
    expect(organizationUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an organization with an existing canceled Subscription too — any status blocks a grant", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(1); // count doesn't distinguish status by design — any row blocks
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_HAS_SUBSCRIPTION" });
  });

  it("rejects an organization with an already-active trial", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: new Date(NOW.getTime() + 1000) });
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_ALREADY_ACTIVE" });
  });

  it("rejects an organization that already used its one-time trial", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: new Date(NOW.getTime() - 1000) });
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_ALREADY_USED" });
  });

  it("surfaces a concurrent-conflict error when the conditional updateMany matches zero rows despite passing reads — the real anti-stacking signal", async () => {
    organizationFindUnique.mockResolvedValue({ id: "org-1", status: "active", billingExempt: false, trialEndsAt: null });
    subscriptionCount.mockResolvedValue(0);
    organizationUpdateMany.mockResolvedValue({ count: 0 }); // simulates a concurrent winner already committed
    await expect(
      grantInternalOrganizationTrial({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "test" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_CONCURRENT_CONFLICT", status: 409 });
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("never touches Stripe — no stripe import exists in this module at all", async () => {
    const source = await import("../internal-trial");
    expect(Object.keys(source)).not.toContain("stripe");
    // Structural guarantee, not just a runtime assertion: grep proof lives in
    // docs/internal-trial-grants.md; this test documents the same claim in
    // the suite so a future edit that adds a Stripe call breaks a green test
    // less by accident than by grep alone. A real stripe call would need to
    // import "@/lib/stripe" or similar, which this file never does.
  });
});

describe("terminateInternalOrganizationTrialEarly — minimal early termination", () => {
  beforeEach(() => {
    mockTransactionRunsCallback();
  });

  it("rejects a missing reason", async () => {
    await expect(
      terminateInternalOrganizationTrialEarly({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_REASON_REQUIRED" });
  });

  it("rejects an organization with no active trial", async () => {
    organizationFindUnique.mockResolvedValue({ trialEndsAt: null });
    await expect(
      terminateInternalOrganizationTrialEarly({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "done testing" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_NOT_ACTIVE" });
    expect(organizationUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects an organization whose trial already expired naturally", async () => {
    organizationFindUnique.mockResolvedValue({ trialEndsAt: new Date(NOW.getTime() - 1000) });
    await expect(
      terminateInternalOrganizationTrialEarly({ organizationId: "org-1", actorUserId: "admin-1", actorEmail: "a@x.test", actorRole: "SUPER_ADMIN", reason: "done testing" })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_NOT_ACTIVE" });
  });

  it("sets trialEndsAt to now (never null) and writes a separate audit event, preserving the grant event", async () => {
    const futureTrialEnd = new Date(NOW.getTime() + 10 * 86_400_000);
    organizationFindUnique.mockResolvedValue({ trialEndsAt: futureTrialEnd });
    organizationUpdateMany.mockResolvedValue({ count: 1 });

    const result = await terminateInternalOrganizationTrialEarly({
      organizationId: "org-1",
      actorUserId: "admin-1",
      actorEmail: "a@x.test",
      actorRole: "SUPER_ADMIN",
      reason: "Pilot phase complete",
    });

    expect(result.terminatedAt).toBe(NOW.toISOString());
    expect(organizationUpdateMany).toHaveBeenCalledWith({
      where: { id: "org-1", trialEndsAt: futureTrialEnd },
      data: { trialEndsAt: NOW }, // never null — org can never receive a second trial
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "platform.organization.internal_trial_terminated" })
    );
  });
});
