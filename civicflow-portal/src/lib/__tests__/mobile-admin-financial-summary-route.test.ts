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

const aggregateDuesCharge = vi.fn();
const aggregateDuesPayment = vi.fn();
const aggregateContribution = vi.fn();
const countPaymentReport = vi.fn();
const countPaymentLinkOfflineReport = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    duesCharge: { aggregate: (...a: unknown[]) => aggregateDuesCharge(...a) },
    duesPayment: { aggregate: (...a: unknown[]) => aggregateDuesPayment(...a) },
    contribution: { aggregate: (...a: unknown[]) => aggregateContribution(...a) },
    paymentReport: { count: (...a: unknown[]) => countPaymentReport(...a) },
    paymentLinkOfflineReport: { count: (...a: unknown[]) => countPaymentLinkOfflineReport(...a) },
  },
}));

import { GET } from "@/app/api/mobile/admin/financial-summary/route";

function request(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/financial-summary?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  countPaymentReport.mockResolvedValue(0);
  countPaymentLinkOfflineReport.mockResolvedValue(0);
});

describe("GET /api/mobile/admin/financial-summary", () => {
  it("requires organizationId", async () => {
    const response = await GET(new Request("https://portal.test/api/mobile/admin/financial-summary", { headers: { Authorization: "Bearer x" } }));
    expect(response.status).toBe(400);
  });

  it("returns 403 without managePayments", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageEvents"] });

    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(aggregateDuesPayment).not.toHaveBeenCalled();
  });

  it("returns 403 when managePayments is held but the org-customized role lacks dues:read", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["contributions:write"]); // no dues:read

    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("computes cents-precise totals via DB aggregate, never floating-point summation", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:read", "dues:write", "contributions:read", "contributions:write"]);
    aggregateDuesCharge.mockResolvedValueOnce({ _sum: { amountDue: "150.30", amountPaid: "100.10" } });
    aggregateDuesPayment.mockResolvedValueOnce({ _sum: { amount: "25.05" } }); // last 30 days
    aggregateDuesPayment.mockResolvedValueOnce({ _sum: { amount: "1000.00" } }); // all-time
    aggregateContribution.mockResolvedValueOnce({ _sum: { amount: "300.75" } });
    countPaymentReport.mockResolvedValueOnce(3);
    countPaymentLinkOfflineReport.mockResolvedValueOnce(1);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    // 150.30 - 100.10 = 50.20 -> 5020 cents, not 5019 or 5021 from float drift
    expect(body.data.duesOutstandingCents).toBe(5020);
    expect(body.data.duesCollected30dCents).toBe(2505);
    expect(body.data.totalDuesCollectedCents).toBe(100000);
    expect(body.data.totalContributionsCents).toBe(30075);
    expect(body.data.pendingPaymentReports).toBe(3);
    expect(body.data.pendingPaymentLinkReports).toBe(1);
  });

  it("handles null aggregate sums (no rows yet) as zero, not NaN", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["managePayments"] });
    getEffectivePermissions.mockResolvedValueOnce(["dues:read"]);
    aggregateDuesCharge.mockResolvedValueOnce({ _sum: { amountDue: null, amountPaid: null } });
    aggregateDuesPayment.mockResolvedValueOnce({ _sum: { amount: null } });
    aggregateDuesPayment.mockResolvedValueOnce({ _sum: { amount: null } });
    aggregateContribution.mockResolvedValueOnce({ _sum: { amount: null } });

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.duesOutstandingCents).toBe(0);
    expect(body.data.totalDuesCollectedCents).toBe(0);
    expect(body.data.totalContributionsCents).toBe(0);
  });
});
