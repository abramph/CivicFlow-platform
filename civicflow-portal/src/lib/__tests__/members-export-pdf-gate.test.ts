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

const orgMemberCount = vi.fn().mockResolvedValue(0);
const orgMemberFindMany = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn().mockResolvedValue({ name: "ThrivePath Foundation" }) },
    orgMember: {
      count: (...args: unknown[]) => orgMemberCount(...args),
      findMany: (...args: unknown[]) => orgMemberFindMany(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { GET } from "@/app/api/members/export/route";

function membersExportRequest(format: string) {
  return new Request(`https://portal.test/api/members/export?format=${format}`);
}

describe("GET /api/members/export — pdfExport plan gate", () => {
  beforeEach(() => {
    requirePlanFeature.mockClear();
    requirePlanFeature.mockResolvedValue(undefined);
    orgMemberCount.mockClear();
    orgMemberCount.mockResolvedValue(0);
    orgMemberFindMany.mockClear();
    orgMemberFindMany.mockResolvedValue([]);
  });

  it("checks pdfExport for a pdf member export", async () => {
    const response = await GET(membersExportRequest("pdf"));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).toHaveBeenCalledWith("org-a", "pdfExport");
  });

  it("never checks pdfExport for a csv export", async () => {
    const response = await GET(membersExportRequest("csv"));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("never checks pdfExport for an xlsx export", async () => {
    const response = await GET(membersExportRequest("xlsx"));
    expect(response.status).toBe(200);
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("never checks pdfExport for the print (browser print-to-PDF) format", async () => {
    const response = await GET(membersExportRequest("print"));
    expect(response.status).toBe(302);
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("returns a standardized 403 PLAN_FEATURE_REQUIRED response when the organization lacks pdfExport", async () => {
    const { PlanFeatureError } = await import("@/lib/plan-gate");
    requirePlanFeature.mockRejectedValueOnce(
      new PlanFeatureError("pdfExport", "This feature is not included in your Free plan. Upgrade to access it.")
    );

    const response = await GET(membersExportRequest("pdf"));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ ok: false, code: "PLAN_FEATURE_REQUIRED", feature: "pdfExport" });
    expect(orgMemberFindMany).not.toHaveBeenCalled();
  });
});
