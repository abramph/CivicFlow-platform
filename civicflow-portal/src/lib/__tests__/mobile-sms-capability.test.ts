import { describe, expect, it } from "vitest";

import { toMobileSmsCapability } from "@/lib/mobile-sms-capability";
import type { SmsEntitlement } from "@/lib/sms-entitlement";

describe("toMobileSmsCapability", () => {
  it("maps an allowed entitlement to available with the remaining allowance and no reason", () => {
    const entitlement: SmsEntitlement = { allowed: true, remaining: 42, limit: 1000 };
    expect(toMobileSmsCapability(entitlement)).toEqual({
      available: true,
      reasonCode: null,
      message: null,
      remaining: 42,
      billingManagementRequired: false,
    });
  });

  it("maps ADD_ON_REQUIRED to a self-serve billing prompt (never leaking the limit)", () => {
    const cap = toMobileSmsCapability({
      allowed: false,
      code: "ADD_ON_REQUIRED",
      reason: "…",
      remaining: 0,
      limit: 0,
    });
    expect(cap.available).toBe(false);
    expect(cap.reasonCode).toBe("ADD_ON_REQUIRED");
    expect(cap.billingManagementRequired).toBe(true);
    expect(cap.remaining).toBeNull();
    expect(cap.message).toMatch(/Settings → Billing/);
  });

  it("maps BILLING_REQUIRED to a self-serve billing prompt", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "BILLING_REQUIRED", remaining: 0, limit: 1000 });
    expect(cap).toMatchObject({ available: false, reasonCode: "BILLING_REQUIRED", billingManagementRequired: true, remaining: null });
  });

  it("maps SUSPENDED to NON-self-serve (an admin action, not a checkout)", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "SUSPENDED", remaining: 0, limit: 1000 });
    expect(cap).toMatchObject({ available: false, reasonCode: "SUSPENDED", billingManagementRequired: false });
  });

  it("maps PLATFORM_MESSAGING_DISABLED to NON-self-serve", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "PLATFORM_MESSAGING_DISABLED", remaining: 0, limit: 0 });
    expect(cap).toMatchObject({ available: false, reasonCode: "PLATFORM_MESSAGING_DISABLED", billingManagementRequired: false });
  });

  it("maps ALLOWANCE_REACHED to NON-self-serve (resets on rollover) and never leaks remaining", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "ALLOWANCE_REACHED", remaining: 0, limit: 1000 });
    expect(cap).toMatchObject({ available: false, reasonCode: "ALLOWANCE_REACHED", billingManagementRequired: false, remaining: null });
  });

  it("defends against a code-less denial by defaulting to ADD_ON_REQUIRED", () => {
    const cap = toMobileSmsCapability({ allowed: false, remaining: 0, limit: 0 });
    expect(cap.available).toBe(false);
    expect(cap.reasonCode).toBe("ADD_ON_REQUIRED");
  });

  it("exposes ONLY the safe presentation fields — never Stripe/Twilio/phone internals", () => {
    const cap = toMobileSmsCapability({ allowed: false, code: "ADD_ON_REQUIRED", remaining: 0, limit: 500 });
    expect(Object.keys(cap).sort()).toEqual(
      ["available", "billingManagementRequired", "message", "reasonCode", "remaining"].sort()
    );
    const serialized = JSON.stringify(cap).toLowerCase();
    for (const forbidden of ["price", "sub_", "prod_", "item", "twilio", "sid", "phone", "+1", "stripe"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
