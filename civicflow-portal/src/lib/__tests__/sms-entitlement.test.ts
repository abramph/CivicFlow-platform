import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueSmsSettings = vi.fn();
const findFirstSubscription = vi.fn();
const updateSmsSettings = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSmsSettings: {
      findUnique: (...args: unknown[]) => findUniqueSmsSettings(...args),
      update: (...args: unknown[]) => updateSmsSettings(...args),
    },
    subscription: {
      findFirst: (...args: unknown[]) => findFirstSubscription(...args),
    },
  },
}));

import { getSmsEntitlement, recordSmsUsage } from "@/lib/sms-entitlement";

describe("getSmsEntitlement", () => {
  beforeEach(() => {
    findUniqueSmsSettings.mockReset();
    findFirstSubscription.mockReset();
    updateSmsSettings.mockClear();
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

  it("allows sending past the monthly limit as a soft cap (overage), not a hard block", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 100,
      smsUsedThisPeriod: 150,
      smsBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(-50);
  });

  it("resets usage and rolls the billing period forward once it has elapsed", async () => {
    findUniqueSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 500,
      smsBillingPeriodEnd: new Date(Date.now() - 1000), // already elapsed
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getSmsEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1000); // usage reset to 0
    expect(updateSmsSettings).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ smsUsedThisPeriod: 0 }) })
    );
  });
});

describe("recordSmsUsage", () => {
  beforeEach(() => {
    updateSmsSettings.mockClear();
  });

  it("atomically increments smsUsedThisPeriod", async () => {
    await recordSmsUsage("org-a");
    expect(updateSmsSettings).toHaveBeenCalledWith({
      where: { organizationId: "org-a" },
      data: { smsUsedThisPeriod: { increment: 1 } },
    });
  });
});
