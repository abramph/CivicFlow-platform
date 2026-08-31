import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * feature/pta-family-agreement-buyout follow-up (FA2 §2/§9). Route-level
 * coverage for Report H's on-screen JSON and .xlsx export routes — proves
 * the actual RBAC gate used ("pta:volunteer-reports:view"/":export", the
 * ORDINARY permission every other non-financial report in this program
 * uses, never the stricter financial-reports permission Report E requires
 * — this report carries no dollar figures at all) and that both routes
 * call the shared builder with the guard's resolved organizationId/actor
 * name, never anything client-supplied.
 */

const requireVolunteerHoursAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAccess: (...a: unknown[]) => requireVolunteerHoursAccess(...a),
}));

const buildFamilyAgreementStatusReportData = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/reports/family-agreement-status", () => ({
  buildFamilyAgreementStatusReportData: (...a: unknown[]) => buildFamilyAgreementStatusReportData(...a),
  FAMILY_AGREEMENT_STATUS_COLUMNS: [],
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
const REPORT_DATA = {
  info: { organizationName: "Lincoln Elementary PTA", reportTitle: "Family Agreement Status Report", requirementPeriodName: "2026-2027 School Year" },
  summary: {},
  rows: [{ householdId: "hh-1" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireVolunteerHoursAccess.mockResolvedValue({ organizationId: "org-1", session: { userId: "u1", userEmail: "staff@example.com" } });
  parseVolunteerReportFilters.mockReturnValue({ requirementPeriodId: "period-1" });
  resolveGeneratedByName.mockResolvedValue("Officer Jones");
  buildFamilyAgreementStatusReportData.mockResolvedValue(REPORT_DATA);
  buildVolunteerReportWorkbook.mockResolvedValue(new Uint8Array([1, 2, 3]));
  buildReportFilename.mockReturnValue("report.xlsx");
});

describe("GET .../reports/family-agreement-status (JSON)", () => {
  it("gates on the ordinary pta:volunteer-reports:view capability, not a financial permission", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test"), { params });
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-reports:view", "reports");
  });

  it("calls the builder with the guard's resolved organizationId and generated-by name, never anything from the request", async () => {
    const { GET } = await import("../route");
    await GET(new Request("https://x.test?householdId=someone-elses-household"), { params });
    expect(buildFamilyAgreementStatusReportData).toHaveBeenCalledWith("org-1", { requirementPeriodId: "period-1" }, "Officer Jones");
  });

  it("returns the builder's data verbatim as JSON", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: REPORT_DATA });
  });

  it("propagates a guard rejection (e.g. capability disabled) without ever calling the builder", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursAccess.mockRejectedValue(new PtaError("PTA_ORGANIZATION_NOT_PTA_VERTICAL", "not permitted"));
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    expect(res.status).not.toBe(200);
    expect(buildFamilyAgreementStatusReportData).not.toHaveBeenCalled();
  });
});

describe("GET .../reports/family-agreement-status/export (.xlsx)", () => {
  it("gates on the ordinary pta:volunteer-reports:export capability", async () => {
    const { GET } = await import("../export/route");
    await GET(new Request("https://x.test"), { params });
    expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-reports:export", "reports");
  });

  it("builds a real workbook, records an audit event, and returns an attachment with the .xlsx content type", async () => {
    const { GET } = await import("../export/route");
    const res = await GET(new Request("https://x.test"), { params });
    expect(buildVolunteerReportWorkbook).toHaveBeenCalledWith(REPORT_DATA, []);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "pta.volunteer_hours.report_exported", metadata: expect.objectContaining({ reportType: "family-agreement-status" }) })
    );
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toContain("report.xlsx");
  });
});
