import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SMS_ENROLLMENT_QUOTA,
  SMS_ENROLLMENT_REASON_MAX_LENGTH,
  SMS_MAX_MONTHLY_QUOTA,
  buildEnrollmentPayload,
  canSubmitEnrollment,
  createEnrollmentSubmitter,
  resolveEnrollmentMode,
  validateEnrollmentForm,
  validateQuota,
  type EnrollmentSubmitDeps,
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

  // (Req 4) storage-bounded max quota, mirrored client + server.
  it("max quota is the int4 ceiling 2,147,483,647", () => {
    expect(SMS_MAX_MONTHLY_QUOTA).toBe(2_147_483_647);
  });
});

describe("validateQuota — upper bound & unsafe integers (Req 4)", () => {
  it("accepts exactly the maximum", () => {
    expect(validateQuota(String(SMS_MAX_MONTHLY_QUOTA))).toBeNull();
  });

  it("rejects one over the maximum", () => {
    expect(validateQuota(String(SMS_MAX_MONTHLY_QUOTA + 1))).toMatch(/cannot exceed/i);
  });

  it("rejects a value beyond the safe-integer range (would overflow int4)", () => {
    expect(validateQuota("99999999999999999999")).toBeTruthy();
  });

  it("validateEnrollmentForm surfaces the over-max quota as a field error", () => {
    const r = validateEnrollmentForm("enable", { reason: "ok", quota: String(SMS_MAX_MONTHLY_QUOTA + 1) });
    expect(r.ok).toBe(false);
    expect(r.quotaError).toMatch(/cannot exceed/i);
  });
});

/**
 * Genuine request-behavior tests for the submit coordinator — the piece that
 * actually issues the PUT. Unlike the pure helpers above, these invoke two
 * submissions WITHOUT waiting for any rerender and assert exactly-one-request
 * behavior, exact payload, single refresh, error retention, and retry.
 */
describe("createEnrollmentSubmitter — synchronous in-flight lock & request behavior (Req 1, 2, 5, 8)", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function makeDeps(request: EnrollmentSubmitDeps["request"]): EnrollmentSubmitDeps {
    return {
      request,
      onStart: vi.fn(),
      onSuccess: vi.fn(),
      onServerError: vi.fn(),
      onNetworkError: vi.fn(),
      onValidationError: vi.fn(),
    };
  }

  it("two immediate valid submissions issue exactly ONE PUT with the exact payload; the second exits before requesting", async () => {
    const coord = createEnrollmentSubmitter("enable");
    const gate = deferred<{ ok: boolean }>();
    const request = vi.fn(() => gate.promise);
    const deps = makeDeps(request);

    // Fire both synchronously — no await between them, so no rerender can run.
    const first = coord.submit({ reason: "  Controlled enrollment  ", quota: "1000" }, deps);
    const secondOutcome = await coord.submit({ reason: "  Controlled enrollment  ", quota: "1000" }, deps);

    expect(secondOutcome).toEqual({ status: "skipped" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "Controlled enrollment" });
    expect(deps.onStart).toHaveBeenCalledTimes(1);

    gate.resolve({ ok: true });
    const firstOutcome = await first;
    expect(firstOutcome.status).toBe("success");
    // Exactly one refresh + close, no error surfaced.
    expect(deps.onSuccess).toHaveBeenCalledTimes(1);
    expect(deps.onServerError).not.toHaveBeenCalled();
  });

  it("disable mode issues exactly { smsAddOnActive:false, reason } once", async () => {
    const coord = createEnrollmentSubmitter("disable");
    const request = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps(request);

    const outcome = await coord.submit({ reason: "Demo wrap-up" }, deps);

    expect(outcome.status).toBe("success");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ smsAddOnActive: false, reason: "Demo wrap-up" });
    expect(deps.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("a server rejection keeps the modal open (no success), surfaces the error, releases the lock, and a retry then succeeds", async () => {
    const coord = createEnrollmentSubmitter("enable");
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "Activation requires a positive monthly quota." })
      .mockResolvedValueOnce({ ok: true });
    const deps = makeDeps(request);

    const firstOutcome = await coord.submit({ reason: "ok", quota: "1000" }, deps);
    expect(firstOutcome.status).toBe("server_error");
    expect(deps.onServerError).toHaveBeenCalledWith("Activation requires a positive monthly quota.");
    expect(deps.onSuccess).not.toHaveBeenCalled(); // modal NOT closed, no refresh

    // Lock released -> the retry is allowed and goes through.
    const retryOutcome = await coord.submit({ reason: "ok", quota: "1000" }, deps);
    expect(retryOutcome.status).toBe("success");
    expect(request).toHaveBeenCalledTimes(2);
    expect(deps.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("a network failure releases the lock (no success/refresh) and a retry works", async () => {
    const coord = createEnrollmentSubmitter("enable");
    const request = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ ok: true });
    const deps = makeDeps(request);

    const firstOutcome = await coord.submit({ reason: "ok", quota: "1000" }, deps);
    expect(firstOutcome.status).toBe("network_error");
    expect(deps.onNetworkError).toHaveBeenCalled();
    expect(deps.onSuccess).not.toHaveBeenCalled();

    const retryOutcome = await coord.submit({ reason: "ok", quota: "1000" }, deps);
    expect(retryOutcome.status).toBe("success");
  });

  it("a client-side validation failure never issues a request and never acquires the lock", async () => {
    const coord = createEnrollmentSubmitter("enable");
    const request = vi.fn();
    const deps = makeDeps(request);

    const outcome = await coord.submit({ reason: "   ", quota: "1000" }, deps); // blank reason
    expect(outcome.status).toBe("invalid");
    expect(request).not.toHaveBeenCalled();
    expect(deps.onStart).not.toHaveBeenCalled();
    expect(deps.onValidationError).toHaveBeenCalled();

    // Lock never acquired, so a subsequent valid submit proceeds normally.
    (request as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const ok = await coord.submit({ reason: "now valid", quota: "1000" }, deps);
    expect(ok.status).toBe("success");
    expect(request).toHaveBeenCalledTimes(1);
  });

  // (Req 9) A non-exempt org resolves to "managed_by_billing", which never
  // renders a submit control (see the render suite) and has no action mode, so
  // no enrollment coordinator is ever constructed and no PUT can be issued.
  it("non-exempt orgs have no action mode, so no enrollment request path exists", () => {
    expect(resolveEnrollmentMode({ billingExempt: false, smsAddOnActive: false })).toBe("managed_by_billing");
    expect(resolveEnrollmentMode({ billingExempt: false, smsAddOnActive: true })).toBe("managed_by_billing");
  });
});
