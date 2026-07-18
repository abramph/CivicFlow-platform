import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "user-1", userEmail: "admin@example.com" },
      organizationId: "org-a",
      role: "ORG_OWNER",
    }),
  };
});

const requirePlanFeature = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/plan-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-gate")>();
  return {
    ...actual,
    requirePlanFeature: (...args: unknown[]) => requirePlanFeature(...args),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findFirst: vi.fn().mockResolvedValue({ name: "ThrivePath Foundation" }) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/reports/report-builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reports/report-builder")>();
  return {
    ...actual,
    buildReport: vi.fn().mockResolvedValue({
      title: "General Financial",
      columns: ["A"],
      rows: [],
      summary: [],
      metadata: { reportType: "GENERAL_FINANCIAL", generatedAt: new Date().toISOString(), startDate: null, endDate: null, filters: {} },
    }),
  };
});

const exportReport = vi.fn().mockResolvedValue(Buffer.from("data"));
vi.mock("@/lib/reports/exporters", () => ({
  exportReport: (...args: unknown[]) => exportReport(...args),
  reportContentType: () => "application/pdf",
  reportFileName: () => "report.pdf",
}));

import { GET } from "@/app/api/reports/export/route";

function reportsExportRequest(params: Record<string, string>) {
  const url = new URL("https://portal.test/api/reports/export");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

describe("GET /api/reports/export — pdfExport plan gate", () => {
  beforeEach(() => {
    requirePlanFeature.mockClear();
    requirePlanFeature.mockResolvedValue(undefined);
    exportReport.mockClear();
  });

  it("checks the pdfExport entitlement only when format=pdf", async () => {
    const response = await GET(reportsExportRequest({ reportType: "GENERAL_FINANCIAL", format: "pdf" }));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).toHaveBeenCalledWith("org-a", "pdfExport");
  });

  it("never checks pdfExport for a csv export", async () => {
    const response = await GET(reportsExportRequest({ reportType: "GENERAL_FINANCIAL", format: "csv" }));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("never checks pdfExport for an xlsx export", async () => {
    const response = await GET(reportsExportRequest({ reportType: "GENERAL_FINANCIAL", format: "xlsx" }));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("returns a standardized 403 PLAN_FEATURE_REQUIRED response when the organization lacks pdfExport", async () => {
    const { PlanFeatureError } = await import("@/lib/plan-gate");
    requirePlanFeature.mockRejectedValueOnce(
      new PlanFeatureError("pdfExport", "This feature is not included in your Free plan. Upgrade to access it.")
    );

    const response = await GET(reportsExportRequest({ reportType: "GENERAL_FINANCIAL", format: "pdf" }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ ok: false, code: "PLAN_FEATURE_REQUIRED", feature: "pdfExport" });
    expect(exportReport).not.toHaveBeenCalled();
  });
});
