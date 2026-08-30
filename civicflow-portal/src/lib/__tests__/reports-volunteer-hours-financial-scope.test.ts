import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deployment-gate review: proves the specific property the review flagged —
 * a background export's financial content must be bounded by the MINIMUM of
 * (permission held at enqueue time, permission held at processing time), not
 * processing time alone. See reports.ts's `includeFinancialsAtEnqueue`
 * comment and .../reports/exports/route.ts's `_includeFinancialsAtEnqueue`
 * snapshot. Distinct from reports-volunteer-hours-allowlist.test.ts (queue
 * claim/allowlist mechanics) and family-summary.test.ts/compliance.test.ts
 * (the builder functions' own includeFinancials parameter behavior) — this
 * file is the only place the WORKER's reconciliation of the two permission
 * checks is exercised directly.
 */
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

const requireVolunteerHoursFlag = vi.fn().mockResolvedValue({});
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursFlag: (...a: unknown[]) => requireVolunteerHoursFlag(...a),
}));

const hasCurrentPermissionForOrg = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  hasCurrentPermissionForOrg: (...a: unknown[]) => hasCurrentPermissionForOrg(...a),
}));

const isVolunteerReportType = vi.fn().mockReturnValue(true);
const buildVolunteerReportExportFile = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/reports/dispatch", () => ({
  isVolunteerReportType: (...a: unknown[]) => isVolunteerReportType(...a),
  buildVolunteerReportExportFile: (...a: unknown[]) => buildVolunteerReportExportFile(...a),
}));

vi.mock("@/lib/labs/pta/volunteer-hours/reports/shared", () => ({
  resolveGeneratedByName: vi.fn().mockResolvedValue("Test Admin"),
  volunteerReportFiltersFromJson: vi.fn().mockReturnValue({}),
}));

const uploadBufferToSpaces = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/storage", () => ({
  buildSafeObjectKey: (...a: unknown[]) => a.join("/"),
  uploadBufferToSpaces: (...a: unknown[]) => uploadBufferToSpaces(...a),
  deleteObjectFromSpaces: vi.fn(),
}));

function exportRow(includeFinancialsAtEnqueue: boolean | undefined) {
  return {
    id: "export-1",
    organizationId: "org-1",
    reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
    filters: includeFinancialsAtEnqueue === undefined ? {} : { requirementPeriodId: "period-1", _includeFinancialsAtEnqueue: includeFinancialsAtEnqueue },
    createdByUserId: "user-1",
    status: "QUEUED",
    attemptCount: 0,
  };
}

describe("processQueuedReportExport — financial scope is bounded by enqueue-time AND processing-time permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireVolunteerHoursFlag.mockResolvedValue({});
    updateManyExport.mockResolvedValue({ count: 1 });
    buildVolunteerReportExportFile.mockResolvedValue({ buffer: Buffer.from("x"), filename: "report.xlsx" });
  });

  it("held at both enqueue and processing time: financial content is included", async () => {
    findFirstExport.mockResolvedValue(exportRow(true));
    hasCurrentPermissionForOrg.mockResolvedValue(true);

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(buildVolunteerReportExportFile).toHaveBeenCalledWith("org-1", "PTA_VOLUNTEER_FAMILY_SUMMARY", expect.anything(), "Test Admin", true);
  });

  it("permission LOST between enqueue and processing: financial content is excluded (reduced, not failed)", async () => {
    findFirstExport.mockResolvedValue(exportRow(true));
    hasCurrentPermissionForOrg.mockResolvedValue(false); // held it at enqueue, lost it since

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(buildVolunteerReportExportFile).toHaveBeenCalledWith("org-1", "PTA_VOLUNTEER_FAMILY_SUMMARY", expect.anything(), "Test Admin", false);
    // Still completes with a (nonfinancial) file -- a lost permission
    // degrades the export, it doesn't need to fail it outright.
    expect(updateManyExport).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
  });

  it("permission GAINED after enqueue: financial content is still excluded -- a later gain can never expand an already-queued export", async () => {
    findFirstExport.mockResolvedValue(exportRow(false)); // did NOT hold it at enqueue
    hasCurrentPermissionForOrg.mockResolvedValue(true); // holds it now, at processing time

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(buildVolunteerReportExportFile).toHaveBeenCalledWith("org-1", "PTA_VOLUNTEER_FAMILY_SUMMARY", expect.anything(), "Test Admin", false);
  });

  it("held at neither moment: financial content is excluded", async () => {
    findFirstExport.mockResolvedValue(exportRow(false));
    hasCurrentPermissionForOrg.mockResolvedValue(false);

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(buildVolunteerReportExportFile).toHaveBeenCalledWith("org-1", "PTA_VOLUNTEER_FAMILY_SUMMARY", expect.anything(), "Test Admin", false);
  });

  it("a pre-existing queued row with no enqueue-time snapshot at all (older row, or unrelated report type) fails closed -- never treated as having held the permission", async () => {
    findFirstExport.mockResolvedValue(exportRow(undefined)); // filters has no _includeFinancialsAtEnqueue key
    hasCurrentPermissionForOrg.mockResolvedValue(true);

    const { processQueuedReportExport } = await import("../reports");
    await processQueuedReportExport("export-1");

    expect(buildVolunteerReportExportFile).toHaveBeenCalledWith("org-1", "PTA_VOLUNTEER_FAMILY_SUMMARY", expect.anything(), "Test Admin", false);
  });
});
