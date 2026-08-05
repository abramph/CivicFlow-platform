import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

vi.mock("@/lib/plan-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-gate")>();
  return { ...actual, requirePlanFeature: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findFirst: vi.fn().mockResolvedValue({ name: "Oak Ridge HOA" }) } },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/reports/report-builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reports/report-builder")>();
  return {
    ...actual,
    buildReport: vi.fn().mockResolvedValue({
      title: "Roster",
      columns: ["Name"],
      rows: [],
      summary: [],
      metadata: { reportType: "TERMINATED_MEMBER_ROSTER", generatedAt: new Date().toISOString(), startDate: null, endDate: null, filters: {} },
    }),
  };
});

vi.mock("@/lib/reports/exporters", () => ({
  exportReport: vi.fn().mockResolvedValue(Buffer.from("data")),
  reportContentType: () => "text/csv",
  reportFileName: () => "report.csv",
}));

import { GET } from "@/app/api/reports/export/route";

function reportsExportRequest(params: Record<string, string>) {
  const url = new URL("https://portal.test/api/reports/export");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

function asRole(role: string) {
  requirePermission.mockResolvedValue({ session: { userId: "u1", userEmail: "u@example.com" }, organizationId: "org-a", role });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reports/export — roster financial-role gate", () => {
  it("DELINQUENT_MEMBER_ROSTER (shows Outstanding Dues) requires a finance/admin role, same as DELINQUENT_MEMBERS", async () => {
    asRole("STAFF");
    const response = await GET(reportsExportRequest({ reportType: "DELINQUENT_MEMBER_ROSTER", format: "csv" }));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toMatch(/finance or administrator role/);
  });

  it("FINANCE role can export DELINQUENT_MEMBER_ROSTER", async () => {
    asRole("FINANCE");
    const response = await GET(reportsExportRequest({ reportType: "DELINQUENT_MEMBER_ROSTER", format: "csv" }));
    expect(response.status).toBe(200);
  });

  it.each(["ACTIVE_MEMBER_ROSTER", "INACTIVE_MEMBER_ROSTER", "TERMINATED_MEMBER_ROSTER"])(
    "%s (no financial columns) does not require a finance/admin role -- any role holding reports:export can access it",
    async (reportType) => {
      asRole("STAFF");
      const response = await GET(reportsExportRequest({ reportType, format: "csv" }));
      expect(response.status).toBe(200);
    }
  );
});
