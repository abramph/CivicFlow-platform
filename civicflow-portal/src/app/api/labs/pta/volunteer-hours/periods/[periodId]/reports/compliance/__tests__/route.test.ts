import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RV-12: proves the actual RBAC gate at the route layer for Report D
 * (Compliance) — found unconditionally leaking `estimatedFinalAssessmentCents`
 * to any caller with mere pta:volunteer-reports:view (the STAFF/READ_ONLY
 * shape) during RV-12's re-verification pass. Mirrors
 * family-summary/__tests__/route.test.ts's exact structure, since this is
 * the same class of gap FC-3 fixed for Report A.
 */

const requireVolunteerHoursAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAccess: (...a: unknown[]) => requireVolunteerHoursAccess(...a),
}));

const buildComplianceReportData = vi.fn();
const getComplianceColumns = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/reports/compliance", () => ({
  buildComplianceReportData: (...a: unknown[]) => buildComplianceReportData(...a),
  getComplianceColumns: (...a: unknown[]) => getComplianceColumns(...a),
}));

const parseVolunteerReportFilters = vi.fn();
const resolveGeneratedByName = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/reports/shared", () => ({
  parseVolunteerReportFilters: (...a: unknown[]) => parseVolunteerReportFilters(...a),
  resolveGeneratedByName: (...a: unknown[]) => resolveGeneratedByName(...a),
}));

const buildVolunteerReportWorkbook = vi.fn();
const buildReportFilename = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/reports/xlsx-builder", () => ({
  buildVolunteerReportWorkbook: (...a: unknown[]) => buildVolunteerReportWorkbook(...a),
  buildReportFilename: (...a: unknown[]) => buildReportFilename(...a),
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const params = Promise.resolve({ periodId: "period-1" });

beforeEach(() => {
  vi.clearAllMocks();
  parseVolunteerReportFilters.mockReturnValue({ requirementPeriodId: "period-1" });
  resolveGeneratedByName.mockResolvedValue("Officer Jones");
  buildComplianceReportData.mockResolvedValue({
    info: { organizationName: "Org", reportTitle: "Volunteer Requirement Compliance Report", requirementPeriodName: "Period" },
    summary: {},
    rows: [],
  });
  getComplianceColumns.mockReturnValue([]);
  buildVolunteerReportWorkbook.mockResolvedValue(new Uint8Array([1, 2, 3]));
  buildReportFilename.mockReturnValue("report.xlsx");
});

describe("GET .../reports/compliance (JSON) — financial-permission gating", () => {
  it("a STAFF-shaped caller (no financial permission) gets includeFinancials=false", async () => {
    requireVolunteerHoursAccess.mockResolvedValue({
      organizationId: "org-1",
      session: { userId: "u1", userEmail: "staff@example.com" },
      can: (p: string) => p === "pta:volunteer-reports:view",
    });
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"), { params });
    expect(buildComplianceReportData).toHaveBeenCalledWith("org-1", expect.anything(), "Officer Jones", false);
  });

  it("a READ_ONLY-shaped caller (no financial permission) also gets includeFinancials=false", async () => {
    requireVolunteerHoursAccess.mockResolvedValue({
      organizationId: "org-1",
      session: { userId: "u2", userEmail: "readonly@example.com" },
      can: () => false,
    });
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"), { params });
    expect(buildComplianceReportData).toHaveBeenCalledWith("org-1", expect.anything(), "Officer Jones", false);
  });

  it("a FINANCE/ORG_ADMIN-shaped caller (holds the financial permission) gets includeFinancials=true", async () => {
    requireVolunteerHoursAccess.mockResolvedValue({
      organizationId: "org-1",
      session: { userId: "u3", userEmail: "finance@example.com" },
      can: (p: string) => p === "pta:volunteer-financial-reports:view" || p === "pta:volunteer-reports:view",
    });
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"), { params });
    expect(buildComplianceReportData).toHaveBeenCalledWith("org-1", expect.anything(), "Officer Jones", true);
  });
});

describe("GET .../reports/compliance/export (.xlsx) — financial-permission gating", () => {
  it("a STAFF-shaped caller gets a workbook built from the nonfinancial column set", async () => {
    requireVolunteerHoursAccess.mockResolvedValue({
      organizationId: "org-1",
      session: { userId: "u1", userEmail: "staff@example.com" },
      can: () => false,
    });
    const { GET } = await import("../export/route");
    await GET(new Request("https://x.test"), { params });
    expect(buildComplianceReportData).toHaveBeenCalledWith("org-1", expect.anything(), "Officer Jones", false);
    expect(getComplianceColumns).toHaveBeenCalledWith(false);
  });

  it("a financial-permission caller gets a workbook built from the full column set", async () => {
    requireVolunteerHoursAccess.mockResolvedValue({
      organizationId: "org-1",
      session: { userId: "u3", userEmail: "finance@example.com" },
      can: () => true,
    });
    const { GET } = await import("../export/route");
    await GET(new Request("https://x.test"), { params });
    expect(buildComplianceReportData).toHaveBeenCalledWith("org-1", expect.anything(), "Officer Jones", true);
    expect(getComplianceColumns).toHaveBeenCalledWith(true);
  });
});
