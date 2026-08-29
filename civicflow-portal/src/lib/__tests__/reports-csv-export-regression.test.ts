import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fix/report-export-queue-hardening — regression coverage for the generic
 * CSV export branch, which existed before this hardening and had no
 * dedicated test file. Confirms the new shared claim/lease/retry machinery
 * doesn't change its success path, and that it deliberately does NOT adopt
 * the PTA-volunteer-specific deterministic-key/expiration behavior (out of
 * scope for this branch, per this program's explicit boundary).
 */

const findFirstExport = vi.fn();
const findManyExports = vi.fn();
const findUniqueExport = vi.fn();
const updateExport = vi.fn();
const updateManyExport = vi.fn();
const createAttachment = vi.fn();
const findManyMembers = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportExport: {
      findFirst: (...a: unknown[]) => findFirstExport(...a),
      findMany: (...a: unknown[]) => findManyExports(...a),
      findUnique: (...a: unknown[]) => findUniqueExport(...a),
      update: (...a: unknown[]) => updateExport(...a),
      updateMany: (...a: unknown[]) => updateManyExport(...a),
    },
    attachment: { create: (...a: unknown[]) => createAttachment(...a) },
    orgMember: { findMany: (...a: unknown[]) => findManyMembers(...a) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const requireVolunteerHoursFlag = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursFlag: (...a: unknown[]) => requireVolunteerHoursFlag(...a),
}));

const isVolunteerReportType = vi.fn().mockReturnValue(false);
const buildVolunteerReportExportFile = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/reports/dispatch", () => ({
  isVolunteerReportType: (...a: unknown[]) => isVolunteerReportType(...a),
  buildVolunteerReportExportFile: (...a: unknown[]) => buildVolunteerReportExportFile(...a),
}));

vi.mock("@/lib/labs/pta/volunteer-hours/reports/shared", () => ({
  resolveGeneratedByName: vi.fn().mockResolvedValue("Test Admin"),
  volunteerReportFiltersFromJson: vi.fn().mockReturnValue({}),
}));

const uploadBufferToSpaces = vi.fn();
const deleteObjectFromSpaces = vi.fn();
vi.mock("@/lib/storage", () => ({
  buildSafeObjectKey: (...a: unknown[]) => a.join("/"),
  uploadBufferToSpaces: (...a: unknown[]) => uploadBufferToSpaces(...a),
  deleteObjectFromSpaces: (...a: unknown[]) => deleteObjectFromSpaces(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  isVolunteerReportType.mockReturnValue(false);
  updateManyExport.mockResolvedValue({ count: 1 });
  updateExport.mockResolvedValue({});
  createAttachment.mockResolvedValue({});
  findManyMembers.mockResolvedValue([]);
  uploadBufferToSpaces.mockResolvedValue(undefined);
  findFirstExport.mockResolvedValue({
    id: "export-1",
    organizationId: "org-1",
    reportType: "MEMBERS",
    filters: {},
    createdByUserId: "user-1",
    status: "QUEUED",
    attemptCount: 0,
  });
});

describe("processQueuedReportExport — generic CSV branch regression", () => {
  it("still completes successfully: uploads, marks COMPLETED, creates an Attachment, no expiresAt set (out of scope for this branch)", async () => {
    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(uploadBufferToSpaces).toHaveBeenCalled();
    expect(createAttachment).toHaveBeenCalled();
    const completionCall = updateExport.mock.calls.find((c) => c[0]?.data?.status === "COMPLETED");
    expect(completionCall).toBeDefined();
    expect(completionCall![0].data.expiresAt).toBeUndefined(); // never set for CSV — retention is unbounded, matching pre-hardening behavior
  });

  it("a transient CSV build/upload failure is retried (bounded), not immediately FAILED — a strict improvement over the pre-hardening immediate-FAILED behavior", async () => {
    uploadBufferToSpaces.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(updateExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED", nextAttemptAt: expect.any(Date) }) }));
    expect(createAttachment).not.toHaveBeenCalled();
  });

  it("a CSV failure at max attempts lands on FAILED with a sanitized message", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-1",
      reportType: "MEMBERS",
      filters: {},
      createdByUserId: "user-1",
      status: "PROCESSING",
      attemptCount: 3,
    });
    uploadBufferToSpaces.mockRejectedValue(new Error("permanent disk full: postgresql://user:pw@host/db"));

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    const failCall = updateExport.mock.calls.find((c) => c[0]?.data?.status === "FAILED");
    expect(failCall).toBeDefined();
    expect(failCall![0].data.errorMessage).not.toContain("pw@host");
  });

  it("an unsupported report type fails immediately without ever attempting a retry", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-1",
      reportType: "SOME_UNKNOWN_TYPE",
      filters: {},
      createdByUserId: "user-1",
      status: "PROCESSING",
      attemptCount: 1,
    });

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(updateExport).toHaveBeenCalledTimes(1);
    expect(updateExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
  });
});

describe("processQueuedReportExports — batch behavior", () => {
  it("claims, processes each, runs cleanup, and returns a summary even with zero eligible jobs", async () => {
    findManyExports.mockResolvedValue([]); // no candidates to claim, nothing to clean up
    const { processQueuedReportExports } = await import("../reports");
    const result = await processQueuedReportExports(10, 10);
    expect(result).toEqual({ processed: 0, cleanupChecked: 0, cleanupDeleted: 0 });
  });

  it("one claimed job's internal failure does not prevent the others in the same batch from being processed", async () => {
    findManyExports
      .mockResolvedValueOnce([{ id: "export-1" }, { id: "export-2" }]) // claim candidates
      .mockResolvedValueOnce([]); // cleanup sweep sees nothing
    findUniqueExport.mockImplementation(async (args: { where: { id: string } }) => ({
      id: args.where.id,
      organizationId: "org-1",
      reportType: "MEMBERS",
      filters: {},
      outputFormat: "csv",
      createdByUserId: "user-1",
      attemptCount: 1,
    }));
    findFirstExport.mockImplementation(async (args: { where: { id: string } }) => ({
      id: args.where.id,
      organizationId: "org-1",
      reportType: "MEMBERS",
      filters: {},
      createdByUserId: "user-1",
      status: "PROCESSING",
      attemptCount: 1,
    }));
    uploadBufferToSpaces.mockImplementation(async () => {
      throw new Error("boom"); // both would "fail" — the point is both still get a terminal resolution, no exception escapes the batch
    });

    const { processQueuedReportExports } = await import("../reports");
    const result = await processQueuedReportExports(10, 10);
    expect(result.processed).toBe(2);
  });
});
