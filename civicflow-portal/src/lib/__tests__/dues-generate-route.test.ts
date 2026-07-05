import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
    }),
  };
});

const findFirstOrgMember = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
    },
  },
}));

const generateMissingDuesChargesForMember = vi.fn().mockResolvedValue({ generated: [], skipped: [] });
const generateMissingDuesChargesForOrganization = vi.fn().mockResolvedValue({ generated: [], skipped: [] });
vi.mock("@/lib/dues-accrual", () => ({
  generateMissingDuesChargesForMember: (...args: unknown[]) => generateMissingDuesChargesForMember(...args),
  generateMissingDuesChargesForOrganization: (...args: unknown[]) => generateMissingDuesChargesForOrganization(...args),
}));

const evaluateMemberDelinquency = vi.fn().mockResolvedValue({ updated: [] });
const evaluateOrganizationDelinquency = vi.fn().mockResolvedValue({ updated: [] });
vi.mock("@/lib/member-delinquency", () => ({
  evaluateMemberDelinquency: (...args: unknown[]) => evaluateMemberDelinquency(...args),
  evaluateOrganizationDelinquency: (...args: unknown[]) => evaluateOrganizationDelinquency(...args),
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { POST } from "@/app/api/dues/generate/route";

function generateRequest(body: Record<string, unknown> = {}) {
  return new Request("https://portal.test/api/dues/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/dues/generate — tenant isolation on memberId", () => {
  beforeEach(() => {
    findFirstOrgMember.mockReset();
    generateMissingDuesChargesForMember.mockClear();
    evaluateMemberDelinquency.mockClear();
  });

  it("404s and never calls the accrual/delinquency logic when memberId belongs to a different organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null); // findFirst({ id, organizationId: "org-a" }) finds nothing

    const response = await POST(generateRequest({ memberId: "member-in-org-b" }));

    expect(response.status).toBe(404);
    expect(findFirstOrgMember).toHaveBeenCalledWith({ where: { id: "member-in-org-b", organizationId: "org-a" } });
    expect(generateMissingDuesChargesForMember).not.toHaveBeenCalled();
    expect(evaluateMemberDelinquency).not.toHaveBeenCalled();
  });

  it("proceeds when memberId belongs to the caller's own organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });

    const response = await POST(generateRequest({ memberId: "member-1" }));

    expect(response.status).toBe(200);
    expect(generateMissingDuesChargesForMember).toHaveBeenCalledWith("member-1", expect.any(Date), undefined);
    expect(evaluateMemberDelinquency).toHaveBeenCalled();
  });

  it("skips the membership check entirely for an organization-wide generate (no memberId)", async () => {
    const response = await POST(generateRequest({}));

    expect(response.status).toBe(200);
    expect(findFirstOrgMember).not.toHaveBeenCalled();
    expect(generateMissingDuesChargesForOrganization).toHaveBeenCalledWith("org-a", expect.any(Date), undefined);
  });
});
