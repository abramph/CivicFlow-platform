import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueWhatsAppSettings = vi.fn();
const findFirstSubscription = vi.fn();
const updateWhatsAppSettings = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationWhatsAppSettings: {
      findUnique: (...args: unknown[]) => findUniqueWhatsAppSettings(...args),
      update: (...args: unknown[]) => updateWhatsAppSettings(...args),
    },
    subscription: {
      findFirst: (...args: unknown[]) => findFirstSubscription(...args),
    },
  },
}));

const getPlatformWhatsAppSettings = vi.fn();
vi.mock("@/lib/whatsapp/credentials", () => ({
  getPlatformWhatsAppSettings: (...args: unknown[]) => getPlatformWhatsAppSettings(...args),
}));

import { getWhatsAppEntitlement, recordWhatsAppUsage } from "@/lib/whatsapp/entitlement";

describe("getWhatsAppEntitlement", () => {
  beforeEach(() => {
    findUniqueWhatsAppSettings.mockReset();
    findFirstSubscription.mockReset();
    updateWhatsAppSettings.mockClear();
    getPlatformWhatsAppSettings.mockReset();
    getPlatformWhatsAppSettings.mockResolvedValue({ orgMessagingEnabled: true });
  });

  it("denies every org when org messaging is disabled platform-wide", async () => {
    getPlatformWhatsAppSettings.mockResolvedValue({ orgMessagingEnabled: false });
    findUniqueWhatsAppSettings.mockResolvedValueOnce({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 0,
    });
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/disabled platform-wide/);
  });

  it("denies an org suspended by a platform administrator, even with an active subscription", async () => {
    findUniqueWhatsAppSettings.mockResolvedValueOnce({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 10,
      whatsappBillingPeriodEnd: new Date(Date.now() + 100_000),
      suspendedAt: new Date(),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/suspended/);
  });

  it("denies an organization with no WhatsApp settings row at all — the state of every org until an admin creates one", async () => {
    findUniqueWhatsAppSettings.mockResolvedValueOnce(null);
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/does not have the WhatsApp add-on/);
  });

  it("denies an organization whose add-on is inactive", async () => {
    findUniqueWhatsAppSettings.mockResolvedValueOnce({
      whatsappAddOnActive: false,
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 0,
      whatsappBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(false);
  });

  it("denies an org with the add-on active but a cancelled subscription", async () => {
    findUniqueWhatsAppSettings.mockResolvedValueOnce({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 10,
      whatsappBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "cancelled" });
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not active/);
  });

  it("allows an org with the add-on active and a past_due subscription", async () => {
    findUniqueWhatsAppSettings.mockResolvedValueOnce({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 10,
      whatsappBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "past_due" });
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(490);
  });

  it("allows sending past the monthly limit as a soft cap (overage), not a hard block", async () => {
    findUniqueWhatsAppSettings.mockResolvedValueOnce({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 100,
      whatsappUsedThisPeriod: 150,
      whatsappBillingPeriodEnd: new Date(Date.now() + 100_000),
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(-50);
  });

  it("resets usage and rolls the billing period forward once it has elapsed", async () => {
    findUniqueWhatsAppSettings.mockResolvedValueOnce({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 200,
      whatsappBillingPeriodEnd: new Date(Date.now() - 1000), // already elapsed
    });
    findFirstSubscription.mockResolvedValueOnce({ status: "active" });
    const result = await getWhatsAppEntitlement("org-a");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(500); // usage reset to 0
    expect(updateWhatsAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ whatsappUsedThisPeriod: 0 }) })
    );
  });
});

describe("recordWhatsAppUsage", () => {
  beforeEach(() => {
    updateWhatsAppSettings.mockClear();
  });

  it("atomically increments whatsappUsedThisPeriod", async () => {
    await recordWhatsAppUsage("org-a");
    expect(updateWhatsAppSettings).toHaveBeenCalledWith({
      where: { organizationId: "org-a" },
      data: { whatsappUsedThisPeriod: { increment: 1 } },
    });
  });
});
