import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCronSecret, validateReportExportCronSecret } from "@/lib/cron-auth";

describe("validateCronSecret", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = original;
  });

  function requestWithAuth(header: string | null) {
    const headers = new Headers();
    if (header !== null) headers.set("authorization", header);
    return new Request("https://portal.test/api/cron/reminders", { headers });
  }

  it("accepts the correct bearer secret", () => {
    expect(validateCronSecret(requestWithAuth("Bearer test-cron-secret"))).toBe(true);
  });

  it("rejects a missing authorization header", () => {
    expect(validateCronSecret(requestWithAuth(null))).toBe(false);
  });

  it("rejects an incorrect secret", () => {
    expect(validateCronSecret(requestWithAuth("Bearer wrong-secret"))).toBe(false);
  });

  it("rejects a secret of a different length without throwing", () => {
    expect(validateCronSecret(requestWithAuth("Bearer short"))).toBe(false);
  });

  it("fails closed when CRON_SECRET itself is not configured", () => {
    delete process.env.CRON_SECRET;
    expect(validateCronSecret(requestWithAuth("Bearer test-cron-secret"))).toBe(false);
  });
});

describe("validateReportExportCronSecret (fix/report-export-queue-hardening)", () => {
  const originalReportSecret = process.env.REPORT_EXPORT_CRON_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.REPORT_EXPORT_CRON_SECRET = originalReportSecret;
    process.env.CRON_SECRET = originalCronSecret;
  });

  function requestWithAuth(header: string | null) {
    const headers = new Headers();
    if (header !== null) headers.set("authorization", header);
    return new Request("https://portal.test/api/cron/reports", { headers });
  }

  it("accepts the correct dedicated secret", () => {
    process.env.REPORT_EXPORT_CRON_SECRET = "dedicated-report-secret";
    expect(validateReportExportCronSecret(requestWithAuth("Bearer dedicated-report-secret"))).toBe(true);
  });

  it("rejects the shared CRON_SECRET — no fallback, dedicated secret only", () => {
    process.env.REPORT_EXPORT_CRON_SECRET = "dedicated-report-secret";
    process.env.CRON_SECRET = "shared-cron-secret";
    expect(validateReportExportCronSecret(requestWithAuth("Bearer shared-cron-secret"))).toBe(false);
  });

  it("fails closed when REPORT_EXPORT_CRON_SECRET is not configured, even if CRON_SECRET is", () => {
    delete process.env.REPORT_EXPORT_CRON_SECRET;
    process.env.CRON_SECRET = "shared-cron-secret";
    expect(validateReportExportCronSecret(requestWithAuth("Bearer shared-cron-secret"))).toBe(false);
    expect(validateReportExportCronSecret(requestWithAuth(null))).toBe(false);
  });

  it("rejects an incorrect dedicated secret without throwing (mismatched length)", () => {
    process.env.REPORT_EXPORT_CRON_SECRET = "dedicated-report-secret";
    expect(validateReportExportCronSecret(requestWithAuth("Bearer x"))).toBe(false);
  });

  it("the dedicated secret does not authorize the shared-secret check either — the two are fully independent", () => {
    process.env.REPORT_EXPORT_CRON_SECRET = "dedicated-report-secret";
    delete process.env.CRON_SECRET;
    expect(validateCronSecret(requestWithAuth("Bearer dedicated-report-secret"))).toBe(false);
  });
});
