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

const findFirstDuesCharge = vi.fn();
const findFirstDuesAccount = vi.fn();
const findFirstOrgMember = vi.fn();
const findFirstPaymentMethodConfig = vi.fn();
const findManyDuesPayment = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    duesCharge: { findFirst: (...args: unknown[]) => findFirstDuesCharge(...args) },
    duesAccount: { findFirst: (...args: unknown[]) => findFirstDuesAccount(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    paymentMethodConfig: { findFirst: (...args: unknown[]) => findFirstPaymentMethodConfig(...args) },
    duesPayment: { findMany: (...args: unknown[]) => findManyDuesPayment(...args) },
  },
}));

const recordDuesPayment = vi.fn();
vi.mock("@/lib/dues-payments", () => ({
  recordDuesPayment: (...args: unknown[]) => recordDuesPayment(...args),
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/dues/payments/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/dues/payments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  memberId: "member-1",
  amount: 60,
  paymentDate: "2026-01-15T00:00:00.000Z",
  method: "CASH",
};

describe("POST /api/dues/payments", () => {
  beforeEach(() => {
    findFirstDuesCharge.mockReset();
    findFirstDuesAccount.mockReset();
    findFirstOrgMember.mockReset();
    findFirstPaymentMethodConfig.mockReset();
    recordDuesPayment.mockReset();
  });

  it("404s when duesChargeId doesn't belong to the caller's organization", async () => {
    findFirstDuesCharge.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ ...validBody, duesChargeId: "charge-other-org" }));

    expect(response.status).toBe(404);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("404s when duesAccountId doesn't belong to the caller's organization", async () => {
    findFirstDuesAccount.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ ...validBody, duesAccountId: "account-other-org" }));

    expect(response.status).toBe(404);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("400s when no member can be resolved from memberId, charge, or account", async () => {
    const response = await POST(
      postRequest({ amount: 60, paymentDate: "2026-01-15T00:00:00.000Z", method: "CASH" })
    );

    expect(response.status).toBe(400);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("404s when the resolved member doesn't exist in the caller's organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(404);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("400s when the selected dues charge belongs to a different member — prevents misattributing a payment", async () => {
    findFirstDuesCharge.mockResolvedValueOnce({ id: "charge-1", organizationId: "org-a", memberId: "member-OTHER", duesAccountId: null });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });

    const response = await POST(postRequest({ ...validBody, duesChargeId: "charge-1" }));

    expect(response.status).toBe(400);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("400s when the selected dues account belongs to a different member", async () => {
    findFirstDuesAccount.mockResolvedValueOnce({ id: "account-1", organizationId: "org-a", memberId: "member-OTHER" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });

    const response = await POST(postRequest({ ...validBody, duesAccountId: "account-1" }));

    expect(response.status).toBe(400);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("404s when paymentMethodId doesn't resolve to an active method in the organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });
    findFirstPaymentMethodConfig.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ ...validBody, paymentMethodId: "pm-other-org" }));

    expect(response.status).toBe(404);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("records a payment applied to the resolved charge/account/member on success", async () => {
    findFirstDuesCharge.mockResolvedValueOnce({ id: "charge-1", organizationId: "org-a", memberId: "member-1", duesAccountId: "account-1", amountDue: 60, amountPaid: 0 });
    findFirstDuesAccount.mockResolvedValueOnce({ id: "account-1", organizationId: "org-a", memberId: "member-1" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });
    recordDuesPayment.mockResolvedValueOnce({
      id: "payment-1",
      memberId: "member-1",
      amount: 60,
      method: "CASH",
      paymentDate: new Date("2026-01-15T00:00:00.000Z"),
      duesChargeId: "charge-1",
      duesAccountId: "account-1",
    });

    const response = await POST(postRequest({ ...validBody, duesChargeId: "charge-1" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(recordDuesPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        memberId: "member-1",
        duesChargeId: "charge-1",
        duesAccountId: "account-1",
        amount: 60,
        method: "CASH",
      })
    );
  });
});

describe("GET /api/dues/payments", () => {
  it("scopes the query to the caller's organization", async () => {
    findManyDuesPayment.mockResolvedValueOnce([]);
    await GET();
    expect(findManyDuesPayment).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});
