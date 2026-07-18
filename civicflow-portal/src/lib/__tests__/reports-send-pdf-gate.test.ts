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

const sendReportEmail = vi.fn().mockResolvedValue({ sent: 1 });
vi.mock("@/lib/reports/email-report", () => ({
  sendReportEmail: (...args: unknown[]) => sendReportEmail(...args),
}));

import { POST } from "@/app/api/reports/send/route";

function sendRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://portal.test/api/reports/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportType: "GENERAL_FINANCIAL",
      format: "pdf",
      deliveryAction: "email_members",
      recipientMode: "all_active",
      includeAttachment: true,
      includeSummary: true,
      subject: "Report",
      body: "See attached.",
      ...overrides,
    }),
  });
}

describe("POST /api/reports/send — pdfExport plan gate", () => {
  beforeEach(() => {
    requirePlanFeature.mockClear();
    requirePlanFeature.mockResolvedValue(undefined);
    exportReport.mockClear();
    sendReportEmail.mockClear();
    sendReportEmail.mockResolvedValue({ sent: 1 });
  });

  it("checks pdfExport when sending a pdf attachment", async () => {
    const response = await POST(sendRequest({ format: "pdf", includeAttachment: true }));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).toHaveBeenCalledWith("org-a", "pdfExport");
  });

  it("never checks pdfExport when includeAttachment is false, regardless of format", async () => {
    const response = await POST(sendRequest({ format: "pdf", includeAttachment: false }));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("never checks pdfExport for a csv attachment", async () => {
    const response = await POST(sendRequest({ format: "csv", includeAttachment: true }));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("returns a standardized 403 PLAN_FEATURE_REQUIRED response when the organization lacks pdfExport", async () => {
    const { PlanFeatureError } = await import("@/lib/plan-gate");
    requirePlanFeature.mockRejectedValueOnce(
      new PlanFeatureError("pdfExport", "This feature is not included in your Free plan. Upgrade to access it.")
    );

    const response = await POST(sendRequest({ format: "pdf", includeAttachment: true }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ ok: false, code: "PLAN_FEATURE_REQUIRED", feature: "pdfExport" });
    expect(sendReportEmail).not.toHaveBeenCalled();
  });
});
