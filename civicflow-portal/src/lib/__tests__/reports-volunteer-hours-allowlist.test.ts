import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstExport = vi.fn();
const updateExport = vi.fn();
const updateManyExport = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportExport: {
      findFirst: (...a: unknown[]) => findFirstExport(...a),
      update: (...a: unknown[]) => updateExport(...a),
      updateMany: (...a: unknown[]) => updateManyExport(...a),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const requireVolunteerHoursFlag = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursFlag: (...a: unknown[]) => requireVolunteerHoursFlag(...a),
}));

const isVolunteerReportType = vi.fn();
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

describe("processQueuedReportExport — pilot allowlist enforcement for volunteer-hours background jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVolunteerReportType.mockReturnValue(true);
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-not-allowlisted",
      reportType: "FAMILY_SUMMARY",
      filters: {},
      createdByUserId: "user-1",
      status: "QUEUED",
      attemptCount: 0,
    });
    // Claim always succeeds in these tests — the atomic-claim mechanics
    // themselves are covered separately in report-export-queue.test.ts.
    updateManyExport.mockResolvedValue({ count: 1 });
    deleteObjectFromSpaces.mockResolvedValue(undefined);
  });

  it("marks the job FAILED (immediately, not retried) and never generates a file when the organization fails requireVolunteerHoursFlag (platform off, not allowlisted, or capability off)", async () => {
    const { PtaError } = await import("../labs/pta/errors");
    requireVolunteerHoursFlag.mockRejectedValue(
      new PtaError("PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED", "Volunteer hour requirements are not available on this platform.")
    );

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(requireVolunteerHoursFlag).toHaveBeenCalledWith("org-not-allowlisted", "reports");
    expect(buildVolunteerReportExportFile).not.toHaveBeenCalled();
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
    // A non-allowlisted organization is a PERMANENT condition — this must
    // land on FAILED on the very first attempt, never scheduled for retry.
    // Claim-ID-conditioned (fix/report-export-queue-hardening follow-up):
    // the terminal write now goes through updateMany, not update.
    expect(updateManyExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(updateManyExport).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED" }) }));
  });

  it("returns a non-allowlisted/disabled organization's job to QUEUED with backoff (not FAILED) only for genuinely transient errors, never burning attempts on a permanent one", async () => {
    requireVolunteerHoursFlag.mockRejectedValue(new Error("ECONNRESET"));

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(updateManyExport).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED", nextAttemptAt: expect.any(Date) }) })
    );
  });

  it("proceeds to generate the file when requireVolunteerHoursFlag resolves (platform on, allowlisted, capability on)", async () => {
    requireVolunteerHoursFlag.mockResolvedValue({});
    buildVolunteerReportExportFile.mockResolvedValue({ buffer: Buffer.from("x"), filename: "report.xlsx" });
    uploadBufferToSpaces.mockResolvedValue(undefined);

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(buildVolunteerReportExportFile).toHaveBeenCalled();
    expect(updateManyExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });

  it("every terminal/renewal write is conditioned on the exact claimId this invocation established at claim time", async () => {
    requireVolunteerHoursFlag.mockResolvedValue({});
    buildVolunteerReportExportFile.mockResolvedValue({ buffer: Buffer.from("x"), filename: "report.xlsx" });
    uploadBufferToSpaces.mockResolvedValue(undefined);

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    // First call is the initial atomic claim (attemptClaimReportExport) —
    // every SUBSEQUENT call (renewals, completion) must carry that exact
    // claimId in its WHERE clause, proving ownership is threaded through
    // consistently rather than re-derived or dropped partway through.
    const claimCallData = updateManyExport.mock.calls[0][0].data;
    const establishedClaimId = claimCallData.claimId;
    expect(establishedClaimId).toBeTruthy();
    for (const call of updateManyExport.mock.calls.slice(1)) {
      expect(call[0].where.claimId).toBe(establishedClaimId);
    }
  });

  it("stops without completing, without an audit event, and without deleting anything when a renewal call reports ownership lost", async () => {
    requireVolunteerHoursFlag.mockResolvedValue({});
    buildVolunteerReportExportFile.mockResolvedValue({ buffer: Buffer.from("x"), filename: "report.xlsx" });
    uploadBufferToSpaces.mockResolvedValue(undefined);
    // First updateMany (the claim) succeeds; every renewal/completion
    // attempt after that reports count:0 (lease reclaimed by someone else).
    updateManyExport.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(createAuditEvent).not.toHaveBeenCalled();
    expect(deleteObjectFromSpaces).not.toHaveBeenCalled();
  });
});
