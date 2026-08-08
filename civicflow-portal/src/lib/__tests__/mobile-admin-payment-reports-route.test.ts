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

const findManyPaymentReport = vi.fn();
const findManyPaymentLinkReport = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentReport: { findMany: (...a: unknown[]) => findManyPaymentReport(...a) },
    paymentLinkOfflineReport: { findMany: (...a: unknown[]) => findManyPaymentLinkReport(...a) },
  },
}));

const approvePaymentReport = vi.fn();
const rejectPaymentReport = vi.fn();
vi.mock("@/lib/payment-report-mutations", () => ({
  approvePaymentReport: (...a: unknown[]) => approvePaymentReport(...a),
  rejectPaymentReport: (...a: unknown[]) => rejectPaymentReport(...a),
}));

const approvePaymentLinkOfflineReport = vi.fn();
const rejectPaymentLinkOfflineReport = vi.fn();
vi.mock("@/lib/payment-link-report-mutations", () => ({
  approvePaymentLinkOfflineReport: (...a: unknown[]) => approvePaymentLinkOfflineReport(...a),
  rejectPaymentLinkOfflineReport: (...a: unknown[]) => rejectPaymentLinkOfflineReport(...a),
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET as paymentReportsGet } from "@/app/api/mobile/admin/payment-reports/route";
import { POST as approvePost } from "@/app/api/mobile/admin/payment-reports/[reportId]/approve/route";
import { POST as rejectPost } from "@/app/api/mobile/admin/payment-reports/[reportId]/reject/route";
import { GET as linkReportsGet } from "@/app/api/mobile/admin/payment-link-reports/route";
import { POST as linkApprovePost } from "@/app/api/mobile/admin/payment-link-reports/[reportId]/approve/route";

function getReq(path: string, qs: string) {
  return new Request(`https://portal.test${path}?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function postReq(path: string, body: Record<string, unknown>) {
  return new Request(`https://portal.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ reportId: "report-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/payment-reports", () => {
  it("returns 403 without dues:read", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce([]);

    const response = await paymentReportsGet(getReq("/api/mobile/admin/payment-reports", "organizationId=org-a"));
    expect(response.status).toBe(403);
    expect(findManyPaymentReport).not.toHaveBeenCalled();
  });

  it("defaults to pending status and ignores an invalid status filter", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:read"]);
    findManyPaymentReport.mockResolvedValueOnce([]);

    await paymentReportsGet(getReq("/api/mobile/admin/payment-reports", "organizationId=org-a&status=bogus"));
    expect(findManyPaymentReport).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", status: "pending" } }));
  });
});

describe("POST /api/mobile/admin/payment-reports/[reportId]/approve", () => {
  it("rejects a crafted organizationId, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    await approvePost(postReq("/x", { organizationId: "org-victim" }), params());

    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(approvePaymentReport).not.toHaveBeenCalled();
  });

  it("delegates to the shared compare-and-swap-safe approvePaymentReport()", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    approvePaymentReport.mockResolvedValueOnce({ ok: true, data: { id: "report-1", status: "approved" } });

    const response = await approvePost(postReq("/x", { organizationId: "org-a", note: "Confirmed in person" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("approved");
    expect(approvePaymentReport).toHaveBeenCalledWith("org-a", { userId: "user-1", userEmail: "officer@example.com" }, "report-1", "Confirmed in person");
  });

  it("surfaces the race-condition error as the same status the shared function returns", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    approvePaymentReport.mockResolvedValueOnce({ ok: false, status: 400, error: "This payment report was just reviewed by someone else. Refresh and try again." });

    const response = await approvePost(postReq("/x", { organizationId: "org-a" }), params());
    expect(response.status).toBe(400);
  });
});

describe("POST /api/mobile/admin/payment-reports/[reportId]/reject", () => {
  it("requires a non-blank rejectionReason", async () => {
    const response = await rejectPost(postReq("/x", { organizationId: "org-a", rejectionReason: "" }), params());
    expect(response.status).toBe(400);
    expect(resolveMobileAdminCapabilities).not.toHaveBeenCalled();
  });

  it("delegates to the shared rejectPaymentReport()", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:write"]);
    rejectPaymentReport.mockResolvedValueOnce({ ok: true, data: { id: "report-1", status: "rejected" } });

    const response = await rejectPost(postReq("/x", { organizationId: "org-a", rejectionReason: "Amount mismatch" }), params());
    expect(response.status).toBe(200);
    expect(rejectPaymentReport).toHaveBeenCalledWith("org-a", { userId: "user-1", userEmail: "officer@example.com" }, "report-1", "Amount mismatch");
  });
});

describe("GET /api/mobile/admin/payment-link-reports", () => {
  it("gates on payment_link_reports:review, a distinct permission from dues:read", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:read"]); // has dues:read but not payment_link_reports:review

    const response = await linkReportsGet(getReq("/api/mobile/admin/payment-link-reports", "organizationId=org-a"));
    expect(response.status).toBe(403);
    expect(findManyPaymentLinkReport).not.toHaveBeenCalled();
  });

  it("lists pending payment-link reports when authorized", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["payment_link_reports:review"]);
    findManyPaymentLinkReport.mockResolvedValueOnce([{ id: "link-report-1" }]);

    const response = await linkReportsGet(getReq("/api/mobile/admin/payment-link-reports", "organizationId=org-a"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ id: "link-report-1" }]);
  });
});

describe("POST /api/mobile/admin/payment-link-reports/[reportId]/approve", () => {
  it("delegates to the shared approvePaymentLinkOfflineReport()", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["payment_link_reports:review"]);
    approvePaymentLinkOfflineReport.mockResolvedValueOnce({ ok: true, data: { id: "report-1", status: "approved" } });

    const response = await linkApprovePost(postReq("/x", { organizationId: "org-a" }), params());
    expect(response.status).toBe(200);
    expect(approvePaymentLinkOfflineReport).toHaveBeenCalledWith("org-a", { userId: "user-1", userEmail: "officer@example.com" }, "report-1", undefined);
  });
});
