import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstExport = vi.fn();
const updateExport = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportExport: {
      findFirst: (...a: unknown[]) => findFirstExport(...a),
      update: (...a: unknown[]) => updateExport(...a),
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
vi.mock("@/lib/storage", () => ({
  buildSafeObjectKey: (...a: unknown[]) => a.join("/"),
  uploadBufferToSpaces: (...a: unknown[]) => uploadBufferToSpaces(...a),
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
    });
  });

  it("marks the job FAILED and never generates a file when the organization fails requireVolunteerHoursFlag (platform off, not allowlisted, or capability off)", async () => {
    requireVolunteerHoursFlag.mockRejectedValue(
      Object.assign(new Error("Volunteer hour requirements are not available on this platform."), {
        code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
      })
    );

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(requireVolunteerHoursFlag).toHaveBeenCalledWith("org-not-allowlisted", "reports");
    expect(buildVolunteerReportExportFile).not.toHaveBeenCalled();
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
    expect(updateExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("proceeds to generate the file when requireVolunteerHoursFlag resolves (platform on, allowlisted, capability on)", async () => {
    requireVolunteerHoursFlag.mockResolvedValue({});
    buildVolunteerReportExportFile.mockResolvedValue({ buffer: Buffer.from("x"), filename: "report.xlsx" });
    uploadBufferToSpaces.mockResolvedValue(undefined);

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(buildVolunteerReportExportFile).toHaveBeenCalled();
    expect(updateExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });
});
