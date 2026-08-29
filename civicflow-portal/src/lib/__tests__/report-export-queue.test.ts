import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findManyExports = vi.fn();
const updateExport = vi.fn();
const updateManyExport = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportExport: {
      findMany: (...a: unknown[]) => findManyExports(...a),
      update: (...a: unknown[]) => updateExport(...a),
      updateMany: (...a: unknown[]) => updateManyExport(...a),
    },
  },
}));

const deleteObjectFromSpaces = vi.fn();
vi.mock("@/lib/storage", () => ({
  deleteObjectFromSpaces: (...a: unknown[]) => deleteObjectFromSpaces(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  updateExport.mockResolvedValue({});
  updateManyExport.mockResolvedValue({ count: 1 });
  deleteObjectFromSpaces.mockResolvedValue(undefined);
});

describe("buildDeterministicVolunteerReportObjectKey", () => {
  it("is fully deterministic — same inputs always produce the same key", async () => {
    const { buildDeterministicVolunteerReportObjectKey } = await import("../report-export-queue");
    const a = buildDeterministicVolunteerReportObjectKey("org-1", "export-1");
    const b = buildDeterministicVolunteerReportObjectKey("org-1", "export-1");
    expect(a).toBe(b);
  });

  it("namespaces by both organizationId and exportId — no collision between exports or organizations", async () => {
    const { buildDeterministicVolunteerReportObjectKey } = await import("../report-export-queue");
    const keys = new Set([
      buildDeterministicVolunteerReportObjectKey("org-1", "export-1"),
      buildDeterministicVolunteerReportObjectKey("org-1", "export-2"),
      buildDeterministicVolunteerReportObjectKey("org-2", "export-1"),
    ]);
    expect(keys.size).toBe(3);
  });

  it("contains no PII — only the opaque organizationId and exportId", async () => {
    const { buildDeterministicVolunteerReportObjectKey } = await import("../report-export-queue");
    const key = buildDeterministicVolunteerReportObjectKey("org-1", "export-1");
    expect(key).toBe("pta-volunteer-reports/org-1/export-1.xlsx");
  });
});

describe("isPermanentReportExportError", () => {
  it("classifies allowlist/flag/period PtaErrors as permanent", async () => {
    const { isPermanentReportExportError } = await import("../report-export-queue");
    const { PtaError } = await import("../labs/pta/errors");
    expect(isPermanentReportExportError(new PtaError("PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED", "x"))).toBe(true);
    expect(isPermanentReportExportError(new PtaError("PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED", "x"))).toBe(true);
    expect(isPermanentReportExportError(new PtaError("PTA_VOLUNTEER_REPORTS_DISABLED", "x"))).toBe(true);
    expect(isPermanentReportExportError(new PtaError("PTA_VOLUNTEER_PERIOD_NOT_FOUND", "x"))).toBe(true);
    expect(isPermanentReportExportError(new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "x"))).toBe(true);
  });

  it("classifies an unrelated PtaError code as NOT permanent (not in the allowlist of known-permanent codes)", async () => {
    const { isPermanentReportExportError } = await import("../report-export-queue");
    const { PtaError } = await import("../labs/pta/errors");
    expect(isPermanentReportExportError(new PtaError("PTA_VALIDATION_ERROR", "x"))).toBe(false);
  });

  it("classifies a plain Error (network blip, unexpected exception) as transient", async () => {
    const { isPermanentReportExportError } = await import("../report-export-queue");
    expect(isPermanentReportExportError(new Error("ECONNRESET"))).toBe(false);
  });

  it("classifies a non-PtaError object carrying a matching .code as transient — instanceof matters, not duck-typing", async () => {
    const { isPermanentReportExportError } = await import("../report-export-queue");
    const fake = Object.assign(new Error("x"), { code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED" });
    expect(isPermanentReportExportError(fake)).toBe(false);
  });
});

describe("sanitizeReportExportErrorMessage", () => {
  it("redacts a Postgres connection string", async () => {
    const { sanitizeReportExportErrorMessage } = await import("../report-export-queue");
    const msg = sanitizeReportExportErrorMessage(new Error("connect failed: postgresql://user:hunter2@host:5432/db"));
    expect(msg).not.toContain("hunter2");
    expect(msg).toContain("[redacted]");
  });

  it("redacts a signed URL's query string", async () => {
    const { sanitizeReportExportErrorMessage } = await import("../report-export-queue");
    const msg = sanitizeReportExportErrorMessage(
      new Error("upload failed for https://bucket.nyc3.digitaloceanspaces.com/key?X-Amz-Signature=abc123&X-Amz-Expires=300")
    );
    expect(msg).not.toContain("abc123");
  });

  it("redacts a bearer token", async () => {
    const { sanitizeReportExportErrorMessage } = await import("../report-export-queue");
    const msg = sanitizeReportExportErrorMessage(new Error("request failed, Authorization: Bearer sk_live_abc123xyz"));
    expect(msg).not.toContain("sk_live_abc123xyz");
  });

  it("redacts an AWS-style access key id", async () => {
    const { sanitizeReportExportErrorMessage } = await import("../report-export-queue");
    const msg = sanitizeReportExportErrorMessage(new Error("AKIAIOSFODNN7EXAMPLE rejected"));
    expect(msg).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("truncates very long messages", async () => {
    const { sanitizeReportExportErrorMessage } = await import("../report-export-queue");
    const msg = sanitizeReportExportErrorMessage(new Error("x".repeat(2000)));
    expect(msg.length).toBeLessThanOrEqual(500);
  });

  it("passes through an ordinary message unchanged (aside from length)", async () => {
    const { sanitizeReportExportErrorMessage } = await import("../report-export-queue");
    expect(sanitizeReportExportErrorMessage(new Error("Volunteer requirement period not found in this organization."))).toBe(
      "Volunteer requirement period not found in this organization."
    );
  });
});

describe("getReportExportRetentionDays", () => {
  const original = process.env.REPORT_EXPORT_RETENTION_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.REPORT_EXPORT_RETENTION_DAYS;
    else process.env.REPORT_EXPORT_RETENTION_DAYS = original;
  });

  it("defaults to 7 when unset", async () => {
    delete process.env.REPORT_EXPORT_RETENTION_DAYS;
    const { getReportExportRetentionDays } = await import("../report-export-queue");
    expect(getReportExportRetentionDays()).toBe(7);
  });

  it("honors a valid override within the safe range", async () => {
    process.env.REPORT_EXPORT_RETENTION_DAYS = "14";
    const { getReportExportRetentionDays } = await import("../report-export-queue");
    expect(getReportExportRetentionDays()).toBe(14);
  });

  it("fails closed to the default for a negative value", async () => {
    process.env.REPORT_EXPORT_RETENTION_DAYS = "-5";
    const { getReportExportRetentionDays } = await import("../report-export-queue");
    expect(getReportExportRetentionDays()).toBe(7);
  });

  it("fails closed to the default for an absurdly large value", async () => {
    process.env.REPORT_EXPORT_RETENTION_DAYS = "99999";
    const { getReportExportRetentionDays } = await import("../report-export-queue");
    expect(getReportExportRetentionDays()).toBe(7);
  });

  it("fails closed to the default for a non-numeric value", async () => {
    process.env.REPORT_EXPORT_RETENTION_DAYS = "not-a-number";
    const { getReportExportRetentionDays } = await import("../report-export-queue");
    expect(getReportExportRetentionDays()).toBe(7);
  });
});

describe("resolveReportExportFailure", () => {
  it("a permanent PtaError goes straight to FAILED on the first attempt", async () => {
    const { resolveReportExportFailure } = await import("../report-export-queue");
    const { PtaError } = await import("../labs/pta/errors");
    const { terminal } = await resolveReportExportFailure("export-1", 1, new PtaError("PTA_VOLUNTEER_REPORTS_DISABLED", "disabled"));
    expect(terminal).toBe(true);
    expect(updateExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("a transient error with attempts remaining returns to QUEUED with nextAttemptAt set", async () => {
    const { resolveReportExportFailure } = await import("../report-export-queue");
    const { terminal } = await resolveReportExportFailure("export-1", 1, new Error("ETIMEDOUT"));
    expect(terminal).toBe(false);
    expect(updateExport).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED", nextAttemptAt: expect.any(Date) }) })
    );
  });

  it("a transient error at the max attempt count goes to FAILED, not another retry", async () => {
    const { resolveReportExportFailure, REPORT_EXPORT_MAX_ATTEMPTS } = await import("../report-export-queue");
    const { terminal } = await resolveReportExportFailure("export-1", REPORT_EXPORT_MAX_ATTEMPTS, new Error("ETIMEDOUT"));
    expect(terminal).toBe(true);
    expect(updateExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("stores the sanitized message, never the raw one, when the raw one contains sensitive content", async () => {
    const { resolveReportExportFailure } = await import("../report-export-queue");
    await resolveReportExportFailure("export-1", 1, new Error("failed: postgresql://user:secretpw@host/db"));
    const call = updateExport.mock.calls[0][0];
    expect(call.data.errorMessage).not.toContain("secretpw");
  });
});

describe("completeReportExport", () => {
  it("sets COMPLETED, fileUrl, completedAt, and an expiresAt in the future", async () => {
    const { completeReportExport } = await import("../report-export-queue");
    await completeReportExport("export-1", "pta-volunteer-reports/org-1/export-1.xlsx");
    const call = updateExport.mock.calls[0][0];
    expect(call.data.status).toBe("COMPLETED");
    expect(call.data.fileUrl).toBe("pta-volunteer-reports/org-1/export-1.xlsx");
    expect(call.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("runReportExportCleanup", () => {
  it("deletes the exact object for each expired COMPLETED export and clears fileUrl", async () => {
    findManyExports.mockResolvedValue([
      { id: "export-1", fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx" },
      { id: "export-2", fileUrl: "pta-volunteer-reports/org-1/export-2.xlsx" },
    ]);
    const { runReportExportCleanup } = await import("../report-export-queue");
    const result = await runReportExportCleanup(25);

    expect(result).toEqual({ checked: 2, deleted: 2 });
    expect(deleteObjectFromSpaces).toHaveBeenCalledWith("pta-volunteer-reports/org-1/export-1.xlsx");
    expect(deleteObjectFromSpaces).toHaveBeenCalledWith("pta-volunteer-reports/org-1/export-2.xlsx");
    expect(deleteObjectFromSpaces).toHaveBeenCalledTimes(2); // never a prefix/bucket-wide call
    expect(updateManyExport).toHaveBeenCalledWith({ where: { id: "export-1" }, data: { fileUrl: null } });
  });

  it("only queries COMPLETED exports with a non-null fileUrl past expiresAt — never touches other statuses", async () => {
    findManyExports.mockResolvedValue([]);
    const { runReportExportCleanup } = await import("../report-export-queue");
    await runReportExportCleanup(25);
    const call = findManyExports.mock.calls[0][0];
    expect(call.where.status).toBe("COMPLETED");
    expect(call.where.fileUrl).toEqual({ not: null });
    expect(call.where.expiresAt).toEqual({ lt: expect.any(Date) });
  });

  it("is idempotent if the object is already absent — a delete failure just leaves fileUrl set for the next sweep, never throws", async () => {
    findManyExports.mockResolvedValue([{ id: "export-1", fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx" }]);
    deleteObjectFromSpaces.mockRejectedValueOnce(new Error("NoSuchKey"));
    const { runReportExportCleanup } = await import("../report-export-queue");
    const result = await runReportExportCleanup(25);
    expect(result.deleted).toBe(0);
    expect(updateManyExport).not.toHaveBeenCalled(); // fileUrl left as-is, retried next sweep
  });

  it("respects the bounded limit", async () => {
    findManyExports.mockResolvedValue([]);
    const { runReportExportCleanup } = await import("../report-export-queue");
    await runReportExportCleanup(5);
    expect(findManyExports.mock.calls[0][0].take).toBe(5);
  });
});

describe("bestEffortCleanupFailedVolunteerReportUpload", () => {
  it("deletes exactly the deterministic key for that exportId, and never throws even if delete fails", async () => {
    const { bestEffortCleanupFailedVolunteerReportUpload } = await import("../report-export-queue");
    deleteObjectFromSpaces.mockRejectedValueOnce(new Error("NoSuchKey"));
    await expect(bestEffortCleanupFailedVolunteerReportUpload("org-1", "export-1")).resolves.toBeUndefined();
    expect(deleteObjectFromSpaces).toHaveBeenCalledWith("pta-volunteer-reports/org-1/export-1.xlsx");
  });
});
