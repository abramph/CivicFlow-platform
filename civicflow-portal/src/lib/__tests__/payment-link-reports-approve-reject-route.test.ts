import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const findFirstReport = vi.fn();
const updateManyReport = vi.fn();
const findUniqueOrThrowReport = vi.fn();
const createContribution = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentLinkOfflineReport: {
      findFirst: (...args: unknown[]) => findFirstReport(...args),
      updateMany: (...args: unknown[]) => updateManyReport(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowReport(...args),
    },
    contribution: {
      create: (...args: unknown[]) => createContribution(...args),
    },
  },
}));

import { POST as approvePOST } from "@/app/api/admin/payment-link-reports/[id]/approve/route";
import { POST as rejectPOST } from "@/app/api/admin/payment-link-reports/[id]/reject/route";

function buildRequest(body: object) {
  return new Request("https://app.getunestra.com/api/admin/payment-link-reports/report-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id = "report-1") {
  return { params: Promise.resolve({ id }) };
}

const pendingReport = {
  id: "report-1",
  organizationId: "org-a",
  status: "pending",
  amount: 50,
  payerName: "Jane Smith",
  payerEmail: "jane@example.com",
  referenceNumber: null,
  paymentMethodConfig: { method: "CHECK" },
  paymentLink: { title: "Annual Fund" },
};

describe("POST /api/admin/payment-link-reports/[id]/approve", () => {
  beforeEach(() => {
    requirePermission.mockReset().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
    });
    findFirstReport.mockReset();
    updateManyReport.mockReset();
    findUniqueOrThrowReport.mockReset();
    createContribution.mockReset();
  });

  it("returns 404 when the report doesn't exist in the caller's organization", async () => {
    findFirstReport.mockResolvedValueOnce(null);

    const response = await approvePOST(buildRequest({}), params());

    expect(response.status).toBe(404);
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("rejects approving a report that's already been reviewed", async () => {
    findFirstReport.mockResolvedValueOnce({ ...pendingReport, status: "approved" });

    const response = await approvePOST(buildRequest({}), params());

    expect(response.status).toBe(400);
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("creates a Contribution using the report's payment method and marks the report approved", async () => {
    findFirstReport.mockResolvedValueOnce(pendingReport);
    createContribution.mockResolvedValueOnce({ id: "contribution-1", amount: 50 });
    updateManyReport.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrowReport.mockResolvedValueOnce({ ...pendingReport, status: "approved" });

    const response = await approvePOST(buildRequest({}), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(createContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-a", paymentMethod: "CHECK", amount: 50 }),
      })
    );
    expect(updateManyReport).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "report-1", organizationId: "org-a", status: "pending" },
        data: expect.objectContaining({ status: "approved", resultingContributionId: "contribution-1" }),
      })
    );
  });

  it("surfaces a conflict when a concurrent reviewer already claimed the report (compare-and-swap loses the race)", async () => {
    findFirstReport.mockResolvedValueOnce(pendingReport);
    createContribution.mockResolvedValueOnce({ id: "contribution-1", amount: 50 });
    updateManyReport.mockResolvedValueOnce({ count: 0 });

    const response = await approvePOST(buildRequest({}), params());

    expect(response.status).toBe(400);
  });
});

describe("POST /api/admin/payment-link-reports/[id]/reject", () => {
  beforeEach(() => {
    requirePermission.mockReset().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
    });
    findFirstReport.mockReset();
    updateManyReport.mockReset();
    findUniqueOrThrowReport.mockReset();
  });

  it("requires a rejectionReason", async () => {
    findFirstReport.mockResolvedValueOnce(pendingReport);

    const response = await rejectPOST(buildRequest({ rejectionReason: "" }), params());

    expect(response.status).toBe(400);
    expect(updateManyReport).not.toHaveBeenCalled();
  });

  it("rejects a report that's already been reviewed", async () => {
    findFirstReport.mockResolvedValueOnce({ ...pendingReport, status: "rejected" });

    const response = await rejectPOST(buildRequest({ rejectionReason: "No matching payment found" }), params());

    expect(response.status).toBe(400);
    expect(updateManyReport).not.toHaveBeenCalled();
  });

  it("marks a pending report rejected with the given reason", async () => {
    findFirstReport.mockResolvedValueOnce(pendingReport);
    updateManyReport.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrowReport.mockResolvedValueOnce({ ...pendingReport, status: "rejected" });

    const response = await rejectPOST(buildRequest({ rejectionReason: "No matching payment found" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(updateManyReport).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "report-1", organizationId: "org-a", status: "pending" },
        data: expect.objectContaining({ status: "rejected", rejectionReason: "No matching payment found" }),
      })
    );
  });
});
