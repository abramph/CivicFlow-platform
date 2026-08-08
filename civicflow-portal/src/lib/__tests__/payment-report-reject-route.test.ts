import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstPaymentReport = vi.fn();
const updateManyPaymentReport = vi.fn().mockResolvedValue({ count: 1 });
const findUniqueOrThrowPaymentReport = vi.fn().mockResolvedValue({ id: "report-1", status: "rejected" });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentReport: {
      findFirst: (...args: unknown[]) => findFirstPaymentReport(...args),
      updateMany: (...args: unknown[]) => updateManyPaymentReport(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowPaymentReport(...args),
    },
  },
}));

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "treasurer@example.com" },
      organizationId: "org-a",
    }),
  };
});

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: false, skipped: true }) }));
vi.mock("@/lib/push", () => ({ sendPushToMember: vi.fn().mockResolvedValue({ sent: 0, failed: 0, skipped: true }) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { POST } from "@/app/api/admin/payment-reports/[id]/reject/route";

function rejectRequest(body: unknown) {
  return new Request("https://portal.test/api/admin/payment-reports/report-1/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pendingReport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "report-1",
    organizationId: "org-a",
    memberId: "member-1",
    status: "pending",
    amount: 50,
    paymentDate: new Date(),
    paymentMethod: "CASH",
    category: "MEMBERSHIP_DUES",
    member: { email: "member@example.com" },
    ...overrides,
  };
}

describe("POST /api/admin/payment-reports/:id/reject", () => {
  beforeEach(() => {
    findFirstPaymentReport.mockReset();
    updateManyPaymentReport.mockClear().mockResolvedValue({ count: 1 });
    findUniqueOrThrowPaymentReport.mockClear();
  });

  it("404s when the report doesn't belong to the caller's organization", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(null);
    const response = await POST(rejectRequest({ rejectionReason: "Not verifiable" }), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(404);
  });

  it("requires a non-blank rejectionReason", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingReport());
    const response = await POST(rejectRequest({ rejectionReason: "" }), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(400);
    expect(updateManyPaymentReport).not.toHaveBeenCalled();
  });

  it("rejects a pending report and records the reason", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingReport());
    const response = await POST(rejectRequest({ rejectionReason: "Amount doesn't match any outstanding charge" }), {
      params: Promise.resolve({ id: "report-1" }),
    });
    expect(response.status).toBe(200);
    expect(updateManyPaymentReport).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "report-1", organizationId: "org-a", status: "pending" }),
        data: expect.objectContaining({ status: "rejected", rejectionReason: "Amount doesn't match any outstanding charge" }),
      })
    );
  });

  it("rejects re-reviewing an already-reviewed report", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingReport({ status: "approved" }));
    const response = await POST(rejectRequest({ rejectionReason: "Too late" }), { params: Promise.resolve({ id: "report-1" }) });
    expect(response.status).toBe(400);
    expect(updateManyPaymentReport).not.toHaveBeenCalled();
  });

  it("returns 400 (not a silent success) when the compare-and-swap loses a race against a concurrent reviewer", async () => {
    findFirstPaymentReport.mockResolvedValueOnce(pendingReport());
    updateManyPaymentReport.mockResolvedValueOnce({ count: 0 });

    const response = await POST(rejectRequest({ rejectionReason: "Amount mismatch" }), { params: Promise.resolve({ id: "report-1" }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/just reviewed by someone else/);
  });
});
