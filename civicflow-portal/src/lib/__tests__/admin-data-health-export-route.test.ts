import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/auth-guards";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requireSuperAdmin: (...a: unknown[]) => requireSuperAdmin(...a) };
});

const getDataHealthFindings = vi.fn();
vi.mock("@/lib/platform-operations/data-health", () => ({
  getDataHealthFindings: (...a: unknown[]) => getDataHealthFindings(...a),
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...a: unknown[]) => createAuditEvent(...a),
}));

import { GET } from "@/app/api/admin/data-health/export/route";

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdmin.mockResolvedValue({ session: { userId: "platform-admin-1", userEmail: "admin@example.com" } });
  getDataHealthFindings.mockResolvedValue([]);
});

describe("GET /api/admin/data-health/export", () => {
  it("requires Platform Admin authorization before exporting findings", async () => {
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Platform role denied: SUPER_ADMIN"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("Platform role denied");
    expect(getDataHealthFindings).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("exports a header-only CSV when there are zero findings", async () => {
    const response = await GET();
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(csv).toBe("Severity,Finding,Detail,Affected Entity Type,Affected Entity Id,Affected Entity Label,Link");
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("exports the same logical finding fields with CSV escaping and formula protection", async () => {
    getDataHealthFindings.mockResolvedValueOnce([
      {
        id: "finding-1",
        severity: "warning",
        title: "Formula-like title",
        explanation: "=starts with formula, includes comma",
        affectedEntity: { type: "pta_household", id: "household-1", label: "+household-label" },
        firstDetectedAt: null,
        href: "/labs/pta/households/household-1",
        source: "database",
      },
    ]);

    const response = await GET();
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(csv).toContain("warning,Formula-like title");
    expect(csv).toContain(`\"'=starts with formula, includes comma\"`);
    expect(csv).toContain("'+household-label");
    expect(csv).toContain("/labs/pta/households/household-1");
    expect(createAuditEvent).not.toHaveBeenCalled();
  });
});
