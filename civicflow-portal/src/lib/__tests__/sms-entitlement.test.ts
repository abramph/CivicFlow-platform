import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueSmsSettings = vi.fn();
const findFirstSubscription = vi.fn();
const findUniqueOrganization = vi.fn();
const updateManySmsSettings = vi.fn().mockResolvedValue({ count: 1 });
const executeRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSmsSettings: {
      findUnique: (...args: unknown[]) => findUniqueSmsSettings(...args),
      updateMany: (...args: unknown[]) => updateManySmsSettings(...args),
    },
    subscription: {
      findFirst: (...args: unknown[]) => findFirstSubscription(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => findUniqueOrganization(...args),
    },
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));

const getPlatformSmsSettings = vi.fn();
vi.mock("@/lib/sms-credentials", () => ({
  getPlatformSmsSettings: (...args: unknown[]) => getPlatformSmsSettings(...args),
}));

import { getSmsEntitlement, releaseSmsAllowance, reserveSmsAllowance } from "@/lib/sms-entitlement";

describe("getSmsEntitlement", () => {
  beforeEach(() => {
    findUniqueSmsSettings.mockReset();
    findFirstSubscription.mockReset();
    findUniqueOrganization.mockReset();
    updateManySmsSettings.mockClear();
    getPlatformSmsSettings.mockReset();
    getPlatformSmsSettings.mockResolvedValue({ orgMessagingEnabled: true });
    // Default: a normal (non-exempt) organization.
    findUniqueOrganization.mockResolvedValue({ billingExempt: false });
  });

  it("denies every org when org messaging is disabled platform-wide", async () => {
    getPlatformSmsSettings.mockResolvedValue({ orgMessagingEnabled: false });
    findUniqueSmsSettings.mockResolvedValueOnce({ smsAddOnActive: true, smsMonthlyLimit: 1000, smsUsedThisPeriod: 0 });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/disabled platform-wide/);
  });

  it("denies an org suspended by a platform administrator, even with an active subscription", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 10,
      smsBillingPeriodEnd: new Date(Date.now() + 100_000),
      suspendedAt: new Date(),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/suspended/);
  });

  it("denies an organization with no SMS settings row at all", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce(null);
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/does not have the SMS add-on/);
  });

  it("denies an organization whose add-on is inactive", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: false,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 0,
      smsBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(false);
  });

  it("deactivating the add-on removes the entitlement immediately — the check is recomputed live, never cached", async () => {
    const settingsRow = {
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 10,
      smsBillingPeriodEnd: new Date(Date.now() + 100_000),
    };
    findUniqueSmsSettings.mockResolvedValueOnce(settingsRow);
    findFirstSubscription.mockResolvedValue({ status: "active" });
    expect((await getSmsEntitlement("org-a")).allowed).toBe(true);

    findUniqueSmsSettings.mockResolvedValueOnce({ ...settingsRow, smsAddOnActive: false });
    expect((await getSmsEntitlement("org-a")).allowed).toBe(false);
  });

  it("allows a paid org with an active subscription and the add-on active", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 10,
      smsBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(990);
  });

  it("denies an org with the add-on active but a cancelled subscription", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 10,
      smsBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "cancelled" });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not active/);
  });

  it("allows an org with the add-on active and a past_due subscription", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 10,
      smsBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "past_due" });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(990);
  });

  describe("billing-exempt organizations", () => {
    it("denies a billing-exempt org WITHOUT explicit SMS enrollment — exemption alone never grants SMS", async () => {
      findUniqueOrganization.mockResolvedValue({ billingExempt: true });
      findUniqueSmsSettings.mockResolvedValueOnce(null);
      const result = await getSmsEntitlement("org-exempt");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/does not have the SMS add-on/);
    });

    it("allows a billing-exempt org WITH explicit audited enrollment and no subscription — exemption satisfies only the base-billing prerequisite", async () => {
      findUniqueOrganization.mockResolvedValue({ billingExempt: true });
      findUniqueSmsSettings.mockResolvedValueOnce({
        smsAddOnActive: true,
        smsMonthlyLimit: 1000,
        smsUsedThisPeriod: 5,
        smsBillingPeriodEnd: new Date(Date.now() + 100_000),
      });
      findFirstSubscription.mockResolvedValueOnce(null);
      const result = await getSmsEntitlement("org-exempt");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(995);
    });

    it("removing billing exemption reconciles immediately: with no active subscription, the next check denies", async () => {
      const settingsRow = {
        smsAddOnActive: true,
        smsMonthlyLimit: 1000,
        smsUsedThisPeriod: 5,
        smsBillingPeriodEnd: new Date(Date.now() + 100_000),
      };
      findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
      findUniqueSmsSettings.mockResolvedValueOnce(settingsRow);
      findFirstSubscription.mockResolvedValue(null);
      expect((await getSmsEntitlement("org-exempt")).allowed).toBe(true);

      findUniqueOrganization.mockResolvedValueOnce({ billingExempt: false });
      findUniqueSmsSettings.mockResolvedValueOnce(settingsRow);
      const revoked = await getSmsEntitlement("org-exempt");
      expect(revoked.allowed).toBe(false);
      expect(revoked.reason).toMatch(/not active/);
    });

    it("one org's exempt enrollment does not leak to another org — every lookup is keyed by the requested organizationId", async () => {
      findUniqueOrganization.mockResolvedValue({ billingExempt: true });
      findUniqueSmsSettings.mockResolvedValueOnce(null); // org-b has no enrollment of its own
      const result = await getSmsEntitlement("org-b");
      expect(result.allowed).toBe(false);
      expect(findUniqueSmsSettings).toHaveBeenCalledWith({ where: { organizationId: "org-b" } });
      expect(findUniqueOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "org-b" } })
      );
    });

    it("a deleted/unknown organization is denied even with an enrolled settings row (fail closed)", async () => {
      findUniqueOrganization.mockResolvedValue(null);
      findUniqueSmsSettings.mockResolvedValueOnce({
        smsAddOnActive: true,
        smsMonthlyLimit: 1000,
        smsUsedThisPeriod: 0,
        smsBillingPeriodEnd: new Date(Date.now() + 100_000),
      });
      findFirstSubscription.mockResolvedValueOnce(null);
      const result = await getSmsEntitlement("org-gone");
      expect(result.allowed).toBe(false);
    });
  });

  describe("monthly quota (SMS_OVERAGE_POLICY = hard_stop, owner-selected Option A)", () => {
    it("hard-stops at the monthly limit — no unbilled overage", async () => {
      findUniqueSmsSettings.mockResolvedValueOnce({
        smsAddOnActive: true,
        smsMonthlyLimit: 100,
        smsUsedThisPeriod: 150,
        smsBillingPeriodEnd: new Date(Date.now() + 100_000),
      });
      findFirstSubscription.mockResolvedValueOnce({ status: "active" });
      const result = await getSmsEntitlement("org-a");
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/monthly SMS allowance/);
      expect(result.remaining).toBe(0);
    });

    it("blocks exactly at the limit boundary (used === limit)", async () => {
      findUniqueSmsSettings.mockResolvedValueOnce({
        smsAddOnActive: true,
        smsMonthlyLimit: 100,
        smsUsedThisPeriod: 100,
        smsBillingPeriodEnd: new Date(Date.now() + 100_000),
      });
      findFirstSubscription.mockResolvedValueOnce({ status: "active" });
      const result = await getSmsEntitlement("org-a");
      expect(result.allowed).toBe(false);
    });
  });

  it("resets usage and rolls the billing period forward once it has elapsed — conditioned on the exact period it read, so concurrent rollovers cannot double-reset", async () => {
    const elapsedEnd = new Date(Date.now() - 1000);
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 500,
      smsBillingPeriodEnd: elapsedEnd, // already elapsed
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1000); // usage reset to 0
    expect(updateManySmsSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a", smsBillingPeriodEnd: elapsedEnd },
        data: expect.objectContaining({ smsUsedThisPeriod: 0 }),
      })
    );
  });

  it("does not treat usage as reset when it LOSES the rollover race (updateMany matched 0 rows)", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 1000,
      smsBillingPeriodEnd: new Date(Date.now() - 1000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    updateManySmsSettings.mockResolvedValueOnce({ count: 0 }); // another racer already rolled it
    const result = await getSmsEntitlement("org-a");
    // Stale usage still reads as at-limit → fail closed rather than oversubscribe.
    expect(result.allowed).toBe(false);
  });
});

describe("reserveSmsAllowance / releaseSmsAllowance", () => {
  beforeEach(() => {
    executeRaw.mockReset();
  });

  it("reserves when the atomic conditional UPDATE claims a row", async () => {
    executeRaw.mockResolvedValueOnce(1);
    await expect(reserveSmsAllowance("org-a")).resolves.toBe(true);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the UPDATE matches no row (allowance exhausted or no settings row)", async () => {
    executeRaw.mockResolvedValueOnce(0);
    await expect(reserveSmsAllowance("org-a")).resolves.toBe(false);
  });

  it("release issues a guarded decrement (never below zero)", async () => {
    executeRaw.mockResolvedValueOnce(1);
    await releaseSmsAllowance("org-a");
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
