import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/rbac";

const findFirstExport = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { reportExport: { findFirst: (...a: unknown[]) => findFirstExport(...a) } } }));

const requireVolunteerHoursAccess = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/guard", () => ({
  requireVolunteerHoursAccess: (...a: unknown[]) => requireVolunteerHoursAccess(...a),
}));

const isVolunteerReportType = vi.fn();
const permissionForVolunteerReportType = vi.fn();
vi.mock("@/lib/labs/pta/volunteer-hours/reports/dispatch", () => ({
  isVolunteerReportType: (...a: unknown[]) => isVolunteerReportType(...a),
  permissionForVolunteerReportType: (...a: unknown[]) => permissionForVolunteerReportType(...a),
}));

const getSignedObjectUrl = vi.fn();
vi.mock("@/lib/storage", () => ({ getSignedObjectUrl: (...a: unknown[]) => getSignedObjectUrl(...a) }));

const params = Promise.resolve({ periodId: "period-1", exportId: "export-1" });

beforeEach(() => {
  vi.clearAllMocks();
  isVolunteerReportType.mockReturnValue(true);
  permissionForVolunteerReportType.mockReturnValue("pta:volunteer-reports:view");
  requireVolunteerHoursAccess.mockResolvedValue({ organizationId: "org-1" });
  getSignedObjectUrl.mockResolvedValue("https://signed.example/download");
});

describe("download route (fix/report-export-queue-hardening: expiration)", () => {
  it("redirects to a signed URL for a COMPLETED, unexpired export", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-1",
      reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
      status: "COMPLETED",
      fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(getSignedObjectUrl).toHaveBeenCalled();
  });

  it("denies a COMPLETED export past its expiresAt with 410, never generating a signed URL", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-1",
      reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
      status: "COMPLETED",
      fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    expect(res.status).toBe(410);
    expect(getSignedObjectUrl).not.toHaveBeenCalled();
  });

  it("a COMPLETED export with no expiresAt (legacy/CSV path) is still downloadable — expiration is opt-in via the field being set", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-1",
      reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
      status: "COMPLETED",
      fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx",
      expiresAt: null,
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  it("QUEUED, PROCESSING, and FAILED exports are all denied with 409 (not ready), never reaching the expiration check", async () => {
    for (const status of ["QUEUED", "PROCESSING", "FAILED"]) {
      findFirstExport.mockResolvedValue({
        id: "export-1",
        organizationId: "org-1",
        reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
        status,
        fileUrl: null,
        expiresAt: null,
      });
      const { GET } = await import("../route");
      const res = await GET(new Request("https://x.test"), { params });
      expect(res.status).toBe(409);
    }
    expect(getSignedObjectUrl).not.toHaveBeenCalled();
  });

  it("re-checks tenant isolation before ever looking at expiresAt — a cross-org session gets 404, not 410", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-OTHER",
      reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
      status: "COMPLETED",
      fileUrl: "pta-volunteer-reports/org-OTHER/export-1.xlsx",
      expiresAt: new Date(Date.now() + 60_000),
    });
    requireVolunteerHoursAccess.mockResolvedValue({ organizationId: "org-1" }); // different org
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    expect(res.status).toBe(404);
  });

  it("an expired COMPLETED export whose object was ALREADY cleaned up (fileUrl null) still returns 410, not a misleading 409 'not ready yet'", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-1",
      reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
      status: "COMPLETED",
      fileUrl: null, // cleanup sweep already ran and cleared this
      expiresAt: new Date(Date.now() - 60_000),
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    expect(res.status).toBe(410);
    expect(getSignedObjectUrl).not.toHaveBeenCalled();
  });

  it("disabling the organization's reports capability blocks downloading an already-completed export (fail-closed) — requireVolunteerHoursAccess itself throws before status/expiry are ever checked", async () => {
    findFirstExport.mockResolvedValue({
      id: "export-1",
      organizationId: "org-1",
      reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
      status: "COMPLETED",
      fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requireVolunteerHoursAccess.mockRejectedValue(new PtaError("PTA_VOLUNTEER_REPORTS_DISABLED", "disabled"));
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x.test"), { params });
    // withApiErrorHandling converts a PtaError into an error Response with
    // the error's own status (never a 2xx, never a redirect) — the point of
    // this test is that this happens BEFORE status/expiry are consulted at
    // all, satisfied by getSignedObjectUrl never having been called.
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(307);
    expect(getSignedObjectUrl).not.toHaveBeenCalled();
  });

  describe("deployment-gate review: dual-mode (Report A/D) download authorization reflects the SPECIFIC file's content, not just the report type's baseline permission", () => {
    it("a Report A export queued WITHOUT financial permission (nonfinancial file) is downloadable by any general reports:view holder", async () => {
      findFirstExport.mockResolvedValue({
        id: "export-1",
        organizationId: "org-1",
        reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
        status: "COMPLETED",
        fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx",
        expiresAt: new Date(Date.now() + 60_000),
        filters: { _includeFinancialsAtEnqueue: false },
      });
      const { GET } = await import("../route");
      const res = await GET(new Request("https://x.test"), { params });
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
      expect(requireVolunteerHoursAccess).toHaveBeenCalledWith("pta:volunteer-reports:view", "reports");
    });

    it("a Report A export queued WITH financial permission (financial-inclusive file) requires the financial permission to download -- a general reports:view-only caller who merely knows the export id is denied", async () => {
      findFirstExport.mockResolvedValue({
        id: "export-1",
        organizationId: "org-1",
        reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY",
        status: "COMPLETED",
        fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx",
        expiresAt: new Date(Date.now() + 60_000),
        filters: { _includeFinancialsAtEnqueue: true },
      });
      const { PtaError } = await import("@/lib/labs/pta/errors");
      // Simulate a STAFF-shaped caller: requireVolunteerHoursAccess throws
      // when asked for the financial permission specifically.
      requireVolunteerHoursAccess.mockImplementation(async (permission: string) => {
        if (permission === PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW) {
          throw new PtaError("PTA_VOLUNTEER_REPORTS_DISABLED", "missing financial permission");
        }
        return { organizationId: "org-1" };
      });

      const { GET } = await import("../route");
      const res = await GET(new Request("https://x.test"), { params });

      expect(requireVolunteerHoursAccess).toHaveBeenCalledWith(PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW, "reports");
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(307);
      expect(getSignedObjectUrl).not.toHaveBeenCalled();
    });

    it("a Report D (compliance) export queued WITH financial permission also requires the financial permission to download", async () => {
      findFirstExport.mockResolvedValue({
        id: "export-1",
        organizationId: "org-1",
        reportType: "PTA_VOLUNTEER_COMPLIANCE",
        status: "COMPLETED",
        fileUrl: "pta-volunteer-reports/org-1/export-1.xlsx",
        expiresAt: new Date(Date.now() + 60_000),
        filters: { _includeFinancialsAtEnqueue: true },
      });
      const { GET } = await import("../route");
      await GET(new Request("https://x.test"), { params });
      expect(requireVolunteerHoursAccess).toHaveBeenCalledWith(PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW, "reports");
    });
  });
});
