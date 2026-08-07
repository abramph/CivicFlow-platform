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
}));

const findFirstOrgMember = vi.fn();
const updateManyOrgMember = vi.fn();
const findUniqueOrThrowOrgMember = vi.fn();
const findFirstCategory = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...a: unknown[]) => findFirstOrgMember(...a),
      updateMany: (...a: unknown[]) => updateManyOrgMember(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowOrgMember(...a),
    },
    category: { findFirst: (...a: unknown[]) => findFirstCategory(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push", () => ({ sendPushToMember: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, PATCH } from "@/app/api/mobile/admin/members/[memberId]/route";

function getRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/members/member-1?${qs}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

function patchRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/members/member-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ memberId: "member-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  updateManyOrgMember.mockResolvedValue({ count: 1 });
});

describe("GET /api/mobile/admin/members/[memberId]", () => {
  it("requires organizationId", async () => {
    const response = await GET(new Request("https://portal.test/api/mobile/admin/members/member-1", { headers: { Authorization: "Bearer x" } }), params());
    expect(response.status).toBe(400);
  });

  it("returns 403 without manageMembers", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await GET(getRequest(), params());
    expect(response.status).toBe(403);
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("returns 404 for a memberId that belongs to a different organization -- never leaks cross-tenant existence", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    // A real, scoped findFirst would return null for a foreign-org id -- the
    // mock demonstrates the route relies on (id, organizationId) together,
    // not id alone.
    findFirstOrgMember.mockResolvedValueOnce(null);

    const response = await GET(getRequest("organizationId=org-a"), params());
    expect(response.status).toBe(404);
    expect(findFirstOrgMember).toHaveBeenCalledWith({ where: { id: "member-1", organizationId: "org-a" } });
  });

  it("returns the member scoped to the requested organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", firstName: "Ada" });

    const response = await GET(getRequest("organizationId=org-a"), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.firstName).toBe("Ada");
  });
});

describe("PATCH /api/mobile/admin/members/[memberId]", () => {
  it("rejects a crafted organizationId that doesn't match any real membership -- capabilities are resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await PATCH(patchRequest({ organizationId: "org-victim", email: "new@example.com" }), params());

    expect(response.status).toBe(403);
    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("rejects setting membershipStatus to terminated -- must use the dedicated terminate route", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "active" });

    const response = await PATCH(patchRequest({ organizationId: "org-a", membershipStatus: "terminated" }), params());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Terminate action/);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("updates a member and returns the fresh row", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "active", email: "old@example.com" });
    findUniqueOrThrowOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "active", email: "new@example.com" });

    const response = await PATCH(patchRequest({ organizationId: "org-a", email: "new@example.com" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.email).toBe("new@example.com");
  });

  it("returns 409 on a concurrent-update conflict", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["manageMembers"] });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "active" });
    updateManyOrgMember.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(patchRequest({ organizationId: "org-a", email: "new@example.com" }), params());
    expect(response.status).toBe(409);
  });
});
