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

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const createReceiptForContribution = vi.fn();
vi.mock("@/lib/receipt-mutations", () => ({
  createReceiptForContribution: (...a: unknown[]) => createReceiptForContribution(...a),
}));

const sendMobileReport = vi.fn();
vi.mock("@/lib/mobile-report-send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-report-send")>();
  return { ...actual, sendMobileReport: (...a: unknown[]) => sendMobileReport(...a) };
});

import { POST as receiptPost } from "@/app/api/mobile/admin/contributions/[contributionId]/receipt/route";
import { POST as reportsSendPost } from "@/app/api/mobile/admin/reports/send/route";

function postReq(path: string, body: Record<string, unknown>) {
  return new Request(`https://portal.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function contributionParams() {
  return { params: Promise.resolve({ contributionId: "contrib-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("POST /api/mobile/admin/contributions/[contributionId]/receipt", () => {
  it("returns 403 without receipts:write, distinct from contributions:write", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]); // no receipts:write

    const response = await receiptPost(postReq("/x", { organizationId: "org-a" }), contributionParams());
    expect(response.status).toBe(403);
    expect(createReceiptForContribution).not.toHaveBeenCalled();
  });

  it("is idempotent -- returns the existing receipt with existing:true", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["receipts:write"]);
    createReceiptForContribution.mockResolvedValueOnce({ ok: true, data: { id: "receipt-1" }, existing: true });

    const response = await receiptPost(postReq("/x", { organizationId: "org-a" }), contributionParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.existing).toBe(true);
  });

  it("creates a new receipt when none exists yet", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["receipts:write"]);
    createReceiptForContribution.mockResolvedValueOnce({ ok: true, data: { id: "receipt-new" } });

    const response = await receiptPost(postReq("/x", { organizationId: "org-a" }), contributionParams());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("receipt-new");
  });
});

describe("POST /api/mobile/admin/reports/send", () => {
  it("returns 403 without manageReports", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });

    const response = await reportsSendPost(postReq("/x", { organizationId: "org-a", reportType: "GENERAL_FINANCIAL" }));
    expect(response.status).toBe(403);
    expect(sendMobileReport).not.toHaveBeenCalled();
  });

  it("returns 403 when manageReports is held but reports:export isn't", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageReports"] });
    getEffectivePermissions.mockResolvedValueOnce(["reports:read"]); // no reports:export

    const response = await reportsSendPost(postReq("/x", { organizationId: "org-a", reportType: "ACTIVE_MEMBER_ROSTER" }));
    expect(response.status).toBe(403);
  });

  it("delegates to sendMobileReport with the resolved role, so the financial-report gate is enforced downstream", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageReports"] });
    getEffectivePermissions.mockResolvedValueOnce(["reports:export"]);
    sendMobileReport.mockResolvedValueOnce({ ok: false, status: 403, error: "Financial report sends require a finance or administrator role." });

    const response = await reportsSendPost(postReq("/x", { organizationId: "org-a", reportType: "GENERAL_FINANCIAL" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/finance or administrator role/);
    expect(sendMobileReport).toHaveBeenCalledWith("org-a", { userId: "user-1", email: "officer@example.com", role: "STAFF" }, expect.objectContaining({ reportType: "GENERAL_FINANCIAL", format: "pdf" }));
  });

  it("succeeds for a FINANCE role requesting a financial report", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["manageReports"] });
    getEffectivePermissions.mockResolvedValueOnce(["reports:export"]);
    sendMobileReport.mockResolvedValueOnce({ ok: true, data: { sent: true } });

    const response = await reportsSendPost(postReq("/x", { organizationId: "org-a", reportType: "OUTSTANDING_DUES", format: "csv" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sent).toBe(true);
  });
});
