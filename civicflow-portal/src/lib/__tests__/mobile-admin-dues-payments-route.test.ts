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

const findFirstDuesCharge = vi.fn();
const findFirstDuesAccount = vi.fn();
const findFirstOrgMember = vi.fn();
const findFirstPaymentMethodConfig = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    duesCharge: { findFirst: (...a: unknown[]) => findFirstDuesCharge(...a) },
    duesAccount: { findFirst: (...a: unknown[]) => findFirstDuesAccount(...a) },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
    paymentMethodConfig: { findFirst: (...a: unknown[]) => findFirstPaymentMethodConfig(...a) },
  },
}));

const recordDuesPayment = vi.fn();
vi.mock("@/lib/dues-payments", () => ({ recordDuesPayment: (...a: unknown[]) => recordDuesPayment(...a) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { POST } from "@/app/api/mobile/admin/dues/payments/route";

function req(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/dues/payments", {
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

describe("POST /api/mobile/admin/dues/payments", () => {
  it("rejects a crafted organizationId with no real dues:write, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]); // no dues:write

    const response = await POST(req({ organizationId: "org-victim", memberId: "member-1", amount: 25, paymentDate: "2026-08-01T00:00:00.000Z" }));

    expect(response.status).toBe(403);
    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("returns 404 when the referenced dues charge is not in this organization (cross-tenant ID manipulation)", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    findFirstDuesCharge.mockResolvedValueOnce(null);

    const response = await POST(
      req({ organizationId: "org-a", memberId: "member-1", duesChargeId: "charge-from-other-org", amount: 25, paymentDate: "2026-08-01T00:00:00.000Z" })
    );

    expect(response.status).toBe(404);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("rejects a charge belonging to a different member than specified (misattribution protection)", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    findFirstDuesCharge.mockResolvedValueOnce({ id: "charge-1", organizationId: "org-a", memberId: "member-OTHER", duesAccountId: null });

    const response = await POST(
      req({ organizationId: "org-a", memberId: "member-1", duesChargeId: "charge-1", amount: 25, paymentDate: "2026-08-01T00:00:00.000Z" })
    );

    expect(response.status).toBe(400);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("records a payment using the same recordDuesPayment() service the web route uses", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    recordDuesPayment.mockResolvedValueOnce({ id: "payment-1", memberId: "member-1", amount: 25, method: "CASH", paymentDate: new Date(), duesChargeId: null, duesAccountId: null });

    const response = await POST(req({ organizationId: "org-a", memberId: "member-1", amount: 25, paymentDate: "2026-08-01T00:00:00.000Z", method: "CASH" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("payment-1");
    expect(recordDuesPayment).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-a", memberId: "member-1", amount: 25 }));
  });

  it("rejects a negative or zero amount before touching the database", async () => {
    const response = await POST(req({ organizationId: "org-a", memberId: "member-1", amount: -5, paymentDate: "2026-08-01T00:00:00.000Z" }));
    expect(response.status).toBe(400);
    expect(resolveMobileAdminCapabilities).not.toHaveBeenCalled();
  });
});
