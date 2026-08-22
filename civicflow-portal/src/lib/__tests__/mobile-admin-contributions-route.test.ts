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

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

// This suite tests mobile-admin capability/permission gating, not the
// subscription gate — assume every organization is allowed.
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: vi.fn().mockResolvedValue({
    allowed: true,
    reason: null,
    trialEndsAt: null,
    subscriptionStatus: null,
    billingExempt: false,
  }),
}));

const findManyContribution = vi.fn();
const findFirstContribution = vi.fn();
const createContributionPrisma = vi.fn();
const updateContributionPrisma = vi.fn();
const findFirstOrgMember = vi.fn();
const findFirstCampaign = vi.fn();
const findFirstEvent = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contribution: {
      findMany: (...a: unknown[]) => findManyContribution(...a),
      findFirst: (...a: unknown[]) => findFirstContribution(...a),
      create: (...a: unknown[]) => createContributionPrisma(...a),
      update: (...a: unknown[]) => updateContributionPrisma(...a),
    },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
    campaign: { findFirst: (...a: unknown[]) => findFirstCampaign(...a) },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/mobile/admin/contributions/route";
import { GET as detailGet, PATCH as detailPatch } from "@/app/api/mobile/admin/contributions/[contributionId]/route";
import { POST as voidPost } from "@/app/api/mobile/admin/contributions/[contributionId]/void/route";

function listReq(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/contributions?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function bodyReq(path: string, body: Record<string, unknown>, method = "POST") {
  return new Request(`https://portal.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ contributionId: "contrib-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/contributions", () => {
  it("returns 403 without contributions:read", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce([]);

    const response = await GET(listReq());
    expect(response.status).toBe(403);
    expect(findManyContribution).not.toHaveBeenCalled();
  });

  it("scopes the list to the requested organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:read"]);
    findManyContribution.mockResolvedValueOnce([]);

    await GET(listReq("organizationId=org-a"));
    expect(findManyContribution).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});

describe("POST /api/mobile/admin/contributions", () => {
  it("rejects a crafted organizationId, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    await POST(bodyReq("/api/mobile/admin/contributions", { organizationId: "org-victim", amount: 20, contributionDate: "2026-08-01T00:00:00.000Z", source: "MANUAL", memberId: "member-1" }));

    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(createContributionPrisma).not.toHaveBeenCalled();
  });

  it("requires attribution to a member, campaign, or event", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]);

    const response = await POST(bodyReq("/api/mobile/admin/contributions", { organizationId: "org-a", amount: 20, contributionDate: "2026-08-01T00:00:00.000Z", source: "MANUAL" }));
    expect(response.status).toBe(400);
    expect(createContributionPrisma).not.toHaveBeenCalled();
  });

  it("creates a contribution using the shared createContribution() service", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]);
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });
    createContributionPrisma.mockResolvedValueOnce({ id: "contrib-new", organizationId: "org-a", memberId: "member-1", amount: 20 });

    const response = await POST(
      bodyReq("/api/mobile/admin/contributions", { organizationId: "org-a", memberId: "member-1", amount: 20, contributionDate: "2026-08-01T00:00:00.000Z", source: "MANUAL" })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("contrib-new");
  });
});

describe("GET /api/mobile/admin/contributions/[contributionId]", () => {
  it("returns 404 for a contribution belonging to a different organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:read"]);
    findFirstContribution.mockResolvedValueOnce(null);

    const response = await detailGet(new Request("https://portal.test/x?organizationId=org-a", { headers: { Authorization: "Bearer test-token" } }), params());
    expect(response.status).toBe(404);
    expect(findFirstContribution).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "contrib-1", organizationId: "org-a" } }));
  });
});

describe("PATCH /api/mobile/admin/contributions/[contributionId]", () => {
  it("blocks editing amount/date on a locked contribution", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]);
    findFirstContribution.mockResolvedValueOnce({ id: "contrib-1", organizationId: "org-a", lockedAt: new Date(), voidedAt: null });

    const response = await detailPatch(bodyReq("/x", { organizationId: "org-a", amount: 999 }, "PATCH"), params());
    expect(response.status).toBe(400);
    expect(updateContributionPrisma).not.toHaveBeenCalled();
  });

  it("blocks editing a voided contribution entirely", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]);
    findFirstContribution.mockResolvedValueOnce({ id: "contrib-1", organizationId: "org-a", lockedAt: null, voidedAt: new Date() });

    const response = await detailPatch(bodyReq("/x", { organizationId: "org-a", notes: "updated" }, "PATCH"), params());
    expect(response.status).toBe(400);
  });
});

describe("POST /api/mobile/admin/contributions/[contributionId]/void", () => {
  it("returns 403 without contributions:write even if managePayments is present", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:read"]);

    const response = await voidPost(bodyReq("/x", { organizationId: "org-a", reason: "Duplicate entry" }), params());
    expect(response.status).toBe(403);
    expect(findFirstContribution).not.toHaveBeenCalled();
  });

  it("rejects voiding an already-voided contribution", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]);
    findFirstContribution.mockResolvedValueOnce({ id: "contrib-1", organizationId: "org-a", voidedAt: new Date(), lockedAt: null });

    const response = await voidPost(bodyReq("/x", { organizationId: "org-a", reason: "Duplicate entry" }), params());
    expect(response.status).toBe(400);
  });
});
