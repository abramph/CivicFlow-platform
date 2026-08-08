import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstPaymentReport = vi.fn();
const findUniqueOrThrowPaymentReport = vi.fn().mockResolvedValue({ id: "report-1", status: "approved" });
const updateManyPaymentReport = vi.fn().mockResolvedValue({ count: 1 });
const findFirstDuesCharge = vi.fn().mockResolvedValue(null);
const createContribution = vi.fn().mockResolvedValue({ id: "contribution-1", amount: 50 });

const txClient = {
  paymentReport: { updateMany: (...args: unknown[]) => updateManyPaymentReport(...args) },
  duesCharge: { findFirst: (...args: unknown[]) => findFirstDuesCharge(...args) },
  contribution: { create: (...args: unknown[]) => createContribution(...args) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentReport: {
      findFirst: (...args: unknown[]) => findFirstPaymentReport(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowPaymentReport(...args),
    },
    $transaction: (fn: (tx: typeof txClient) => unknown) => fn(txClient),
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

function pendingDuesReport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

describe("POST /api/admin/payment-reports/:id/approve", () => {
  beforeEach(() => {
    findFirstPaymentReport.mockReset();
    findUniqueOrThrowPaymentReport.mockClear();
    updateManyPaymentReport.mockClear().mockResolvedValue({ count: 1 });
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
    findFirstPaymentReport.mockResolvedValueOnce(pendingDuesReport({ status: "approved" }));

    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(400);
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("applies a pending report to the member's oldest outstanding charge and marks it approved", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingDuesReport());
    findFirstDuesCharge.mockResolvedValueOnce({ id: "charge-1", amountDue: 50, amountPaid: 0 });

    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(200);

    expect(updateManyPaymentReport).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "report-1", organizationId: "org-a", status: "pending" }),
        data: expect.objectContaining({ status: "approved" }),
      })
    );
    expect(recordDuesPayment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", duesChargeId: "charge-1" }),
      txClient
    );
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("records a Contribution instead of a DuesPayment for a non-dues category, and never looks up a dues charge", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingDuesReport({ amount: 75, category: "DONATION", referenceNumber: null }));

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

  it("never creates a DuesPayment or Contribution when the compare-and-swap loses a race against a concurrent reviewer (no orphaned financial record)", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingDuesReport());
    // Simulates a concurrent approve/reject landing between this route's
    // findFirst read and its own updateMany claim.
    updateManyPaymentReport.mockResolvedValueOnce({ count: 0 });

    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/just reviewed by someone else/);
    expect(recordDuesPayment).not.toHaveBeenCalled();
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("never creates a Contribution when the compare-and-swap loses a race, for a non-dues category too", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingDuesReport({ category: "DONATION" }));
    updateManyPaymentReport.mockResolvedValueOnce({ count: 0 });

    const response = await POST(approveRequest(), { params: Promise.resolve({ id: "report-1" }) });

    expect(response.status).toBe(400);
    expect(createContribution).not.toHaveBeenCalled();
  });
});
