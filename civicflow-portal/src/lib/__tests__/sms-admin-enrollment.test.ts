import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMS_ENROLLMENT_QUOTA,
  SMS_ENROLLMENT_REASON_MAX_LENGTH,
  buildEnrollmentPayload,
  canSubmitEnrollment,
  resolveEnrollmentMode,
  validateEnrollmentForm,
  validateQuota,
} from "@/lib/sms-admin-enrollment";

describe("resolveEnrollmentMode", () => {
  // (Req 1) an inactive billing-exempt org gets the Enable form.
  it("billing-exempt + inactive → 'enable'", () => {
    expect(resolveEnrollmentMode({ billingExempt: true, smsAddOnActive: false })).toBe("enable");
  });

  // (Req 8/11) an active billing-exempt org gets the Disable action / renders Enabled.
  it("billing-exempt + active → 'disable'", () => {
    expect(resolveEnrollmentMode({ billingExempt: true, smsAddOnActive: true })).toBe("disable");
  });

  // (Req 9) a non-exempt (paid) org never gets a super-admin enable/disable control.
  it("non-exempt → 'managed_by_billing' regardless of active state", () => {
    expect(resolveEnrollmentMode({ billingExempt: false, smsAddOnActive: false })).toBe("managed_by_billing");
    expect(resolveEnrollmentMode({ billingExempt: false, smsAddOnActive: true })).toBe("managed_by_billing");
  });
});

describe("validateQuota (Req 3 — positive whole number only)", () => {
  it("accepts a positive integer", () => {
    expect(validateQuota("1000")).toBeNull();
    expect(validateQuota("  50  ")).toBeNull();
  });

  it("rejects zero", () => {
    expect(validateQuota("0")).toMatch(/greater than zero/i);
  });

  it("rejects a negative number", () => {
    expect(validateQuota("-5")).toMatch(/positive whole number/i);
  });

  it("rejects a decimal", () => {
    expect(validateQuota("10.5")).toMatch(/positive whole number/i);
  });

  it("rejects a non-numeric value", () => {
    expect(validateQuota("abc")).toMatch(/positive whole number/i);
    expect(validateQuota("1e3")).toMatch(/positive whole number/i);
  });

  it("rejects a missing/empty value", () => {
    expect(validateQuota("")).toMatch(/enter a monthly message quota/i);
    expect(validateQuota("   ")).toMatch(/enter a monthly message quota/i);
  });
});

describe("validateEnrollmentForm — enable mode", () => {
  // (Req 2) blank / whitespace-only reason is blocked client-side.
  it("blocks a blank reason", () => {
    const r = validateEnrollmentForm("enable", { reason: "", quota: "1000" });
    expect(r.ok).toBe(false);
    expect(r.reasonError).toMatch(/reason is required/i);
  });

  it("blocks a whitespace-only reason", () => {
    const r = validateEnrollmentForm("enable", { reason: "   ", quota: "1000" });
    expect(r.ok).toBe(false);
    expect(r.reasonError).toMatch(/reason is required/i);
  });

  it("blocks a reason longer than the server maximum", () => {
    const r = validateEnrollmentForm("enable", { reason: "x".repeat(SMS_ENROLLMENT_REASON_MAX_LENGTH + 1), quota: "1000" });
    expect(r.ok).toBe(false);
    expect(r.reasonError).toMatch(new RegExp(`${SMS_ENROLLMENT_REASON_MAX_LENGTH}`));
  });

  // (Req 3) invalid quota blocks submission.
  it("blocks an invalid quota", () => {
    for (const bad of ["0", "-1", "3.5", "lots", ""]) {
      const r = validateEnrollmentForm("enable", { reason: "Controlled enrollment", quota: bad });
      expect(r.ok, `quota ${JSON.stringify(bad)} should be rejected`).toBe(false);
      expect(r.quotaError).toBeTruthy();
    }
  });

  it("accepts a valid reason + quota and returns the trimmed reason and parsed integer", () => {
    const r = validateEnrollmentForm("enable", { reason: "  Controlled demo enrollment  ", quota: " 1000 " });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("Controlled demo enrollment");
    expect(r.quota).toBe(1000);
    expect(r.reasonError).toBeUndefined();
    expect(r.quotaError).toBeUndefined();
  });
});

describe("validateEnrollmentForm — disable mode (Req 8)", () => {
  it("requires a non-empty reason and ignores quota", () => {
    const blank = validateEnrollmentForm("disable", { reason: "   " });
    expect(blank.ok).toBe(false);
    expect(blank.reasonError).toMatch(/reason is required/i);

    const ok = validateEnrollmentForm("disable", { reason: "Demo wrap-up" });
    expect(ok.ok).toBe(true);
    expect(ok.reason).toBe("Demo wrap-up");
    expect(ok.quota).toBeUndefined();
    expect(ok.quotaError).toBeUndefined();
  });
});

describe("buildEnrollmentPayload (Req 4 & 8 — exact PUT shape; Req 10 — no Stripe ids)", () => {
  it("enable → exactly { smsAddOnActive:true, smsMonthlyLimit, reason }", () => {
    const payload = buildEnrollmentPayload("enable", { reason: "Controlled enrollment", quota: 1000 });
    expect(payload).toEqual({ smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "Controlled enrollment" });
    // No extra keys — the server derives everything else (plan, period, pricing).
    expect(Object.keys(payload).sort()).toEqual(["reason", "smsAddOnActive", "smsMonthlyLimit"]);
  });

  it("disable → exactly { smsAddOnActive:false, reason }", () => {
    const payload = buildEnrollmentPayload("disable", { reason: "Demo wrap-up" });
    expect(payload).toEqual({ smsAddOnActive: false, reason: "Demo wrap-up" });
    expect(Object.keys(payload).sort()).toEqual(["reason", "smsAddOnActive"]);
  });

  it("never carries a Stripe identifier of any kind", () => {
    const enable = buildEnrollmentPayload("enable", { reason: "x", quota: 5 });
    const disable = buildEnrollmentPayload("disable", { reason: "x" });
    for (const key of [...Object.keys(enable), ...Object.keys(disable)]) {
      expect(key.toLowerCase()).not.toContain("stripe");
    }
  });
});

describe("canSubmitEnrollment (Req 5 — double-submit guard)", () => {
  it("is false while a request is in flight and true otherwise", () => {
    expect(canSubmitEnrollment({ submitting: true })).toBe(false);
    expect(canSubmitEnrollment({ submitting: false })).toBe(true);
  });
});

describe("constants mirror the product/server contract", () => {
  it("default quota is 1,000 and reason max mirrors the server's 500", () => {
    expect(DEFAULT_SMS_ENROLLMENT_QUOTA).toBe(1000);
    expect(SMS_ENROLLMENT_REASON_MAX_LENGTH).toBe(500);
  });
});
