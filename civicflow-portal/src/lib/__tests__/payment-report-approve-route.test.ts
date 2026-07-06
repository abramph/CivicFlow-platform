import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstPaymentReport = vi.fn();
const updatePaymentReport = vi.fn().mockResolvedValue({ id: "report-1", status: "approved" });
const findFirstDuesCharge = vi.fn().mockResolvedValue(null);
const createContribution = vi.fn().mockResolvedValue({ id: "contribution-1", amount: 50 });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentReport: {
      findFirst: (...args: unknown[]) => findFirstPaymentReport(...args),
      update: (...args: unknown[]) => updatePaymentReport(...args),
    },
    duesCharge: { findFirst: (...args: unknown[]) => findFirstDuesCharge(...args) },
    contribution: { create: (...args: unknown[]) => createContribution(...args) },
  },
}));

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "treasurer@example.com" },
      organizationId: "org-a",
      role: "FINANCE",
    }),
  };
});

const recordDuesPayment = vi.fn().mockResolvedValue({ id: "dues-payment-1", amount: 50 });
vi.mock("@/lib/dues-payments", () => ({
  recordDuesPayment: (...args: unknown[]) => recordDuesPayment(...args),
}));

vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: false, skipped: true }) }));
vi.mock("@/lib/push", () => ({ sendPushToMember: vi.fn().mockResolvedValue({ sent: 0, failed: 0, skipped: true }) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { POST } from "@/app/api/admin/payment-reports/[id]/approve/route";

function approveRequest(body: unknown = {}) {
  return new Request("https://portal.test/api/admin/payment-reports/report-1/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/payment-reports/:id/approve", () => {
  beforeEach(() => {
    findFirstPaymentReport.mockReset();
    updatePaymentReport.mockClear();
    recordDuesPayment.mockClear();
    createContribution.mockClear();
    findFirstDuesCharge.mockClear();
  });

  it("404s when the report doesn't belong to the caller's organization", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(null);
    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(404);
  });

  it("rejects approving a report that was already reviewed", async () => {
    findFirstPaymentReport.mockResolvedValueOnce({
      id: "report-1",
      organizationId: "org-a",
      memberId: "member-1",
      status: "approved",
      amount: 50,
      paymentDate: new Date(),
      paymentMethod: "CASH",
      referenceNumber: null,
      category: "MEMBERSHIP_DUES",
      member: { email: "member@example.com" },
    });

    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(400);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("applies a pending report to the member's oldest outstanding charge and marks it approved", async () => {
    findFirstPaymentReport.mockResolvedValueOnce({
      id: "report-1",
      organizationId: "org-a",
      memberId: "member-1",
      status: "pending",
      amount: 50,
      paymentDate: new Date(),
      paymentMethod: "CASH",
      referenceNumber: "REF-1",
      category: "MEMBERSHIP_DUES",
      member: { email: "member@example.com" },
    });
    findFirstDuesCharge.mockResolvedValueOnce({ id: "charge-1", amountDue: 50, amountPaid: 0 });

    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(200);

    expect(recordDuesPayment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", duesChargeId: "charge-1" })
    );
    expect(updatePaymentReport).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved" }) })
    );
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("records a Contribution instead of a DuesPayment for a non-dues category, and never looks up a dues charge", async () => {
    findFirstPaymentReport.mockResolvedValueOnce({
      id: "report-1",
      organizationId: "org-a",
      memberId: "member-1",
      status: "pending",
      amount: 75,
      paymentDate: new Date(),
      paymentMethod: "CASH",
      referenceNumber: null,
      category: "DONATION",
      member: { email: "member@example.com" },
    });

    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(200);

    expect(recordDuesPayment).not.toHaveBeenCalled();
    expect(findFirstDuesCharge).not.toHaveBeenCalled();
    expect(createContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-a", memberId: "member-1", source: "MANUAL" }),
      })
    );
  });
});
