import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findFirstSubscription = vi.fn();
const findUniqueOrgSmsSettings = vi.fn();
const upsertOrgSmsSettings = vi.fn();
const updateOrgSmsSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findFirst: (...args: unknown[]) => findFirstSubscription(...args) },
    organizationSmsSettings: {
      findUnique: (...args: unknown[]) => findUniqueOrgSmsSettings(...args),
      upsert: (...args: unknown[]) => upsertOrgSmsSettings(...args),
      update: (...args: unknown[]) => updateOrgSmsSettings(...args),
    },
  },
}));

const addSmsAddOnToSubscription = vi.fn();
const removeSmsAddOnFromSubscription = vi.fn();
vi.mock("@/lib/stripe", () => ({
  addSmsAddOnToSubscription: (...args: unknown[]) => addSmsAddOnToSubscription(...args),
  removeSmsAddOnFromSubscription: (...args: unknown[]) => removeSmsAddOnFromSubscription(...args),
}));

import { GET, POST } from "@/app/api/billing/sms-addon/route";

const session = { userId: "user-1", userEmail: "owner@example.com" };

describe("/api/billing/sms-addon", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue({ session, organizationId: "org-1" });
    findFirstSubscription.mockReset();
    findUniqueOrgSmsSettings.mockReset().mockResolvedValue(null);
    upsertOrgSmsSettings.mockReset();
    addSmsAddOnToSubscription.mockReset();
    createAuditEvent.mockClear();
  });

  it("GET reports quota/pricing numbers only — no Stripe identifiers and no legacy overage rate presented to clients", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce({
      smsAddOnActive: true,
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 10,
      smsOverageRateCents: 2,
      smsBillingPeriodEnd: null,
      stripeSmsSubscriptionItemId: "si_secret_item",
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(JSON.stringify(json)).not.toMatch(/price_|si_|[Oo]verage/);
    expect(Object.keys(json.data).sort()).toEqual([
      "includedMessagesPerMonth",
      "monthlyPriceCents",
      "smsAddOnActive",
      "smsBillingPeriodEnd",
      "smsMonthlyLimit",
      "smsUsedThisPeriod",
    ]);
  });

  it("POST is open under the resolved hard-stop policy but still requires a paid Stripe subscription first — fail-safe order, no Stripe call, no entitlement write", async () => {
    findFirstSubscription.mockResolvedValueOnce(null);

    const res = await POST();

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Subscribe to a paid plan/);
    expect(addSmsAddOnToSubscription).not.toHaveBeenCalled();
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });
});
