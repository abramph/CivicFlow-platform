import { beforeEach, describe, expect, it, vi } from "vitest";

const getSmsEntitlement = vi.fn();
vi.mock("@/lib/sms-entitlement", () => ({
  getSmsEntitlement: (...args: unknown[]) => getSmsEntitlement(...args),
}));

const getSmsPlatformStatus = vi.fn();
vi.mock("@/lib/sms-operational-status", () => ({
  getSmsPlatformStatus: (...args: unknown[]) => getSmsPlatformStatus(...args),
}));

import { getMobileSmsCapability, toMobileSmsCapability } from "@/lib/mobile-sms-capability";
import type { SmsEntitlement } from "@/lib/sms-entitlement";

describe("toMobileSmsCapability (pure entitlement projection)", () => {
  it("maps an allowed entitlement to available with the remaining allowance and no reason", () => {
    const entitlement: SmsEntitlement = { allowed: true, remaining: 42, limit: 1000 };
    expect(toMobileSmsCapability(entitlement)).toEqual({
      available: true,
      restricted: false,
      reasonCode: null,
      message: null,
      remaining: 42,
      billingManagementRequired: false,
    });
  });

  it("maps a NON-exempt ADD_ON_REQUIRED to a self-serve billing prompt (never leaking the limit)", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "ADD_ON_REQUIRED", reason: "…", remaining: 0, limit: 0 });
    expect(cap).toMatchObject({ available: false, reasonCode: "ADD_ON_REQUIRED", billingManagementRequired: true, remaining: null });
    expect(cap.message).toMatch(/Settings → Billing/);
  });

  it("maps a billing-EXEMPT ADD_ON_REQUIRED to contact-support (NO billing link, since billing isn't the remedy)", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "ADD_ON_REQUIRED_EXEMPT", remaining: 0, limit: 0 });
    expect(cap).toMatchObject({ available: false, reasonCode: "ADD_ON_REQUIRED_EXEMPT", billingManagementRequired: false, remaining: null });
    expect(cap.message).toMatch(/Contact Unestra support/);
    expect(cap.message).not.toMatch(/Billing/);
  });

  it("maps BILLING_REQUIRED to self-serve, SUSPENDED / ALLOWANCE_REACHED to non-self-serve", () => {
    expect(toMobileSmsCapability({ allowed: false, code: "BILLING_REQUIRED", remaining: 0, limit: 1000 })).toMatchObject({
      billingManagementRequired: true,
    });
    expect(toMobileSmsCapability({ allowed: false, code: "SUSPENDED", remaining: 0, limit: 1000 })).toMatchObject({
      billingManagementRequired: false,
    });
    expect(toMobileSmsCapability({ allowed: false, code: "ALLOWANCE_REACHED", remaining: 0, limit: 1000 })).toMatchObject({
      billingManagementRequired: false,
      remaining: null,
    });
  });

  it("exposes ONLY the safe presentation fields — never Stripe/Twilio/phone internals", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "ADD_ON_REQUIRED", remaining: 0, limit: 500 });
    expect(Object.keys(cap).sort()).toEqual(
      ["available", "billingManagementRequired", "message", "reasonCode", "remaining", "restricted"].sort()
    );
    const serialized = JSON.stringify(cap).toLowerCase();
    for (const forbidden of ["price", "sub_", "prod_", "item", "twilio", "sid", "phone", "+1", "stripe"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("getMobileSmsCapability (platform gate + entitlement + Safe Launch)", () => {
  beforeEach(() => {
    getSmsPlatformStatus.mockReset();
    getSmsEntitlement.mockReset();
    // Default: platform fully up, org entitled.
    getSmsPlatformStatus.mockResolvedValue({ configured: true, available: true, testMode: false });
    getSmsEntitlement.mockResolvedValue({ allowed: true, remaining: 100, limit: 1000 });
  });

  it("fails closed for each platform-operational block, WITHOUT consulting entitlement", async () => {
    for (const code of ["NOT_CONFIGURED", "PLATFORM_DISABLED", "MAINTENANCE", "OUTBOUND_PAUSED"] as const) {
      getSmsPlatformStatus.mockResolvedValueOnce({ configured: code !== "NOT_CONFIGURED", available: false, unavailableCode: code, testMode: false });
      const cap = await getMobileSmsCapability("org-a");
      expect(cap).toMatchObject({ available: false, reasonCode: code, billingManagementRequired: false });
      expect(cap.message).toBeTruthy();
    }
    // Platform gate short-circuits before the per-org entitlement query.
    expect(getSmsEntitlement).not.toHaveBeenCalled();
  });

  it("surfaces an entitlement denial when the platform is up", async () => {
    getSmsEntitlement.mockResolvedValueOnce({ allowed: false, code: "ADD_ON_REQUIRED", remaining: 0, limit: 0 });
    const cap = await getMobileSmsCapability("org-a");
    expect(cap).toMatchObject({ available: false, reasonCode: "ADD_ON_REQUIRED", billingManagementRequired: true });
  });

  it("reports a truthful RESTRICTED state when entitled but Safe Launch (test mode) is on", async () => {
    getSmsPlatformStatus.mockResolvedValueOnce({ configured: true, available: true, testMode: true });
    const cap = await getMobileSmsCapability("org-a");
    expect(cap).toMatchObject({ available: true, restricted: true, reasonCode: "RESTRICTED_TEST_MODE", remaining: 100 });
    expect(cap.message).toMatch(/verified test numbers/i);
  });

  it("reports fully available (unrestricted) when platform is up, entitled, and not in test mode", async () => {
    const cap = await getMobileSmsCapability("org-a");
    expect(cap).toEqual({
      available: true,
      restricted: false,
      reasonCode: null,
      message: null,
      remaining: 100,
      billingManagementRequired: false,
    });
  });
});
