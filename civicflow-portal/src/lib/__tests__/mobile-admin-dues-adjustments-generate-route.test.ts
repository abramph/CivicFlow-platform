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

const findFirstOrgMember = vi.fn();
const findFirstDuesCharge = vi.fn();
const createDuesAdjustmentPrisma = vi.fn();
const updateDuesCharge = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
    duesCharge: { findFirst: (...a: unknown[]) => findFirstDuesCharge(...a), update: (...a: unknown[]) => updateDuesCharge(...a) },
    duesAdjustment: { create: (...a: unknown[]) => createDuesAdjustmentPrisma(...a) },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        duesAdjustment: { create: (...a: unknown[]) => createDuesAdjustmentPrisma(...a) },
        duesCharge: { update: (...a: unknown[]) => updateDuesCharge(...a) },
      }),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const generateMissingDuesChargesForMember = vi.fn();
vi.mock("@/lib/dues-accrual", () => ({
  generateMissingDuesChargesForMember: (...a: unknown[]) => generateMissingDuesChargesForMember(...a),
  generateMissingDuesChargesForOrganization: vi.fn(),
}));
const evaluateMemberDelinquency = vi.fn();
vi.mock("@/lib/member-delinquency", () => ({
  evaluateMemberDelinquency: (...a: unknown[]) => evaluateMemberDelinquency(...a),
  evaluateOrganizationDelinquency: vi.fn(),
}));

import { POST as adjustmentsPost } from "@/app/api/mobile/admin/dues/adjustments/route";
import { POST as generatePost } from "@/app/api/mobile/admin/dues/generate/route";

function req(path: string, body: Record<string, unknown>) {
  return new Request(`https://portal.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  findFirstOrgMember.mockResolvedValue({ id: "member-1", organizationId: "org-a" });
});

describe("POST /api/mobile/admin/dues/adjustments", () => {
  it("returns 403 when managePayments is held but dues:write isn't", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce([]);

    const response = await adjustmentsPost(
      req("/api/mobile/admin/dues/adjustments", { organizationId: "org-a", memberId: "member-1", adjustmentType: "CREDIT", amount: 10, reason: "Courtesy credit" })
    );
    expect(response.status).toBe(403);
    expect(createDuesAdjustmentPrisma).not.toHaveBeenCalled();
  });

  it("returns 404 for a member not in this organization (cross-tenant)", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    findFirstOrgMember.mockResolvedValueOnce(null);

    const response = await adjustmentsPost(
      req("/api/mobile/admin/dues/adjustments", { organizationId: "org-a", memberId: "member-other-org", adjustmentType: "CREDIT", amount: 10, reason: "Courtesy credit" })
    );
    expect(response.status).toBe(404);
  });

  it("requires a reason of at least 3 characters", async () => {
    const response = await adjustmentsPost(
      req("/api/mobile/admin/dues/adjustments", { organizationId: "org-a", memberId: "member-1", adjustmentType: "CREDIT", amount: 10, reason: "ok" })
    );
    expect(response.status).toBe(400);
    expect(resolveMobileAdminCapabilities).not.toHaveBeenCalled();
  });

  it("creates an adjustment using the shared createDuesAdjustment() service", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    createDuesAdjustmentPrisma.mockResolvedValueOnce({ id: "adj-1", adjustmentType: "CREDIT", amount: 10, reason: "Courtesy credit" });

    const response = await adjustmentsPost(
      req("/api/mobile/admin/dues/adjustments", { organizationId: "org-a", memberId: "member-1", adjustmentType: "CREDIT", amount: 10, reason: "Courtesy credit" })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("adj-1");
  });
});

describe("POST /api/mobile/admin/dues/generate", () => {
  it("returns 403 without dues:write", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce([]);

    const response = await generatePost(req("/api/mobile/admin/dues/generate", { organizationId: "org-a", memberId: "member-1" }));
    expect(response.status).toBe(403);
    expect(generateMissingDuesChargesForMember).not.toHaveBeenCalled();
  });

  it("returns 404 for a member in a different organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    findFirstOrgMember.mockResolvedValueOnce(null);

    const response = await generatePost(req("/api/mobile/admin/dues/generate", { organizationId: "org-a", memberId: "member-victim" }));
    expect(response.status).toBe(404);
    expect(generateMissingDuesChargesForMember).not.toHaveBeenCalled();
  });

  it("generates charges for the specified member only (never whole-org)", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    generateMissingDuesChargesForMember.mockResolvedValueOnce({ created: 2 });
    evaluateMemberDelinquency.mockResolvedValueOnce({ changed: false });

    const response = await generatePost(req("/api/mobile/admin/dues/generate", { organizationId: "org-a", memberId: "member-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.result).toEqual({ created: 2 });
    expect(generateMissingDuesChargesForMember).toHaveBeenCalledWith("member-1", expect.any(Date), undefined);
  });
});
