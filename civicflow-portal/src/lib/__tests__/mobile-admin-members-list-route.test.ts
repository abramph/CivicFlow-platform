import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileAuth = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const resolveMobileAdminCapabilities = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  resolveMobileAdminCapabilities: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
  requireMobileAdminAccess: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

const countOrgMember = vi.fn();
const findManyOrgMember = vi.fn();
const createOrgMember = vi.fn();
const findFirstCategory = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      count: (...a: unknown[]) => countOrgMember(...a),
      findMany: (...a: unknown[]) => findManyOrgMember(...a),
      create: (...a: unknown[]) => createOrgMember(...a),
    },
    category: { findFirst: (...a: unknown[]) => findFirstCategory(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/plan-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-gate")>();
  return { ...actual, requireMemberSlot: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/mobile/admin/members/route";

function listRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/members?${qs}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

function createRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/members", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/members", () => {
  it("requires organizationId", async () => {
    const response = await GET(new Request("https://portal.test/api/mobile/admin/members", { headers: { Authorization: "Bearer x" } }));
    expect(response.status).toBe(400);
  });

  it("returns 403 when the caller lacks manageMembers for this org", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageEvents"] });

    const response = await GET(listRequest());
    expect(response.status).toBe(403);
    expect(findManyOrgMember).not.toHaveBeenCalled();
  });

  it("returns 403 when the org has no admin access at all (e.g. Labs not enrolled)", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await GET(listRequest());
    expect(response.status).toBe(403);
  });

  it("scopes the list query to the requested organizationId and returns paginated results", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["adminDashboard", "manageMembers"] });
    countOrgMember.mockResolvedValueOnce(3);
    findManyOrgMember.mockResolvedValueOnce([{ id: "m-1", firstName: "Ada", lastName: "Lovelace" }]);

    const response = await GET(listRequest("organizationId=org-a&search=ada"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-a" }),
        skip: 0,
        take: 25,
      })
    );
    expect(body.data.members).toEqual([{ id: "m-1", firstName: "Ada", lastName: "Lovelace" }]);
    expect(body.data.total).toBe(3);
    expect(body.data.hasMore).toBe(false);
  });

  it("clamps an out-of-range pageSize to the server-side maximum", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    countOrgMember.mockResolvedValueOnce(0);
    findManyOrgMember.mockResolvedValueOnce([]);

    await GET(listRequest("organizationId=org-a&pageSize=99999"));

    expect(findManyOrgMember).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});

describe("POST /api/mobile/admin/members", () => {
  it("returns 403 when the caller lacks manageMembers for the supplied organizationId", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await POST(createRequest({ organizationId: "org-a", firstName: "Ada", lastName: "Lovelace" }));
    expect(response.status).toBe(403);
    expect(createOrgMember).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant attempt: capabilities are always re-resolved for the organizationId in THIS request's body, not any cached/prior org", async () => {
    // Regression coverage for a crafted-organizationId attack: the guard must
    // be called with the exact organizationId from this request, and its
    // result (not the caller's membership in some other org) determines access.
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    await POST(createRequest({ organizationId: "org-victim", firstName: "Eve", lastName: "Attacker" }));

    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(createOrgMember).not.toHaveBeenCalled();
  });

  it("rejects missing required fields with 400 before touching the database", async () => {
    const response = await POST(createRequest({ organizationId: "org-a" }));
    expect(response.status).toBe(400);
    expect(resolveMobileAdminCapabilities).not.toHaveBeenCalled();
    expect(createOrgMember).not.toHaveBeenCalled();
  });

  it("creates a member using the same createMember() service the web form uses", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["adminDashboard", "manageMembers"] });
    createOrgMember.mockResolvedValueOnce({ id: "m-new", organizationId: "org-a", firstName: "Ada", lastName: "Lovelace", membershipStatus: "active" });

    const response = await POST(createRequest({ organizationId: "org-a", firstName: "Ada", lastName: "Lovelace" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("m-new");
    expect(createOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", firstName: "Ada", lastName: "Lovelace" }) })
    );
  });

  it("returns 404 when membershipCategoryId doesn't resolve within the organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    findFirstCategory.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({ organizationId: "org-a", firstName: "Ada", lastName: "Lovelace", membershipCategoryId: "cat-missing" })
    );

    expect(response.status).toBe(404);
    expect(createOrgMember).not.toHaveBeenCalled();
  });
});
