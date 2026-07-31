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

const findFirstContribution = vi.fn();
const findFirstOrgMember = vi.fn();
const findFirstContributionReceipt = vi.fn();
const createContributionReceipt = vi.fn();
const findManyContributionReceipt = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contribution: { findFirst: (...args: unknown[]) => findFirstContribution(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    contributionReceipt: {
      findFirst: (...args: unknown[]) => findFirstContributionReceipt(...args),
      create: (...args: unknown[]) => createContributionReceipt(...args),
      findMany: (...args: unknown[]) => findManyContributionReceipt(...args),
    },
  },
}));

const generateAndStoreReceiptPdf = vi.fn();
vi.mock("@/lib/receipt", () => ({
  generateAndStoreReceiptPdf: (...args: unknown[]) => generateAndStoreReceiptPdf(...args),
}));

const getSignedObjectUrl = vi.fn();
vi.mock("@/lib/storage", () => ({
  getSignedObjectUrl: (...args: unknown[]) => getSignedObjectUrl(...args),
}));

const sendReceiptEmail = vi.fn();
vi.mock("@/lib/mail", () => ({
  sendReceiptEmail: (...args: unknown[]) => sendReceiptEmail(...args),
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/receipts/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/receipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/receipts", () => {
  beforeEach(() => {
    findFirstContribution.mockReset();
    findFirstOrgMember.mockReset();
    findFirstContributionReceipt.mockReset();
    createContributionReceipt.mockReset();
    generateAndStoreReceiptPdf.mockReset();
    getSignedObjectUrl.mockReset();
    sendReceiptEmail.mockReset();
  });

  it("404s when the contribution doesn't belong to the caller's organization", async () => {
    findFirstContribution.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ contributionId: "contribution-other-org" }));

    expect(response.status).toBe(404);
    expect(createContributionReceipt).not.toHaveBeenCalled();
  });

  it("404s when memberId doesn't belong to the caller's organization", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "contribution-1", organizationId: "org-a", memberId: null, amount: 100, contributionDate: new Date() });
    findFirstOrgMember.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ contributionId: "contribution-1", memberId: "member-other-org" }));

    expect(response.status).toBe(404);
    expect(createContributionReceipt).not.toHaveBeenCalled();
  });

  it("is idempotent — returns the existing receipt instead of creating a duplicate for the same contribution", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "contribution-1", organizationId: "org-a", memberId: null, amount: 100, contributionDate: new Date() });
    findFirstContributionReceipt.mockResolvedValueOnce({ id: "receipt-1", contributionId: "contribution-1" });

    const response = await POST(postRequest({ contributionId: "contribution-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { id: "receipt-1", contributionId: "contribution-1" }, existing: true });
    expect(createContributionReceipt).not.toHaveBeenCalled();
    expect(generateAndStoreReceiptPdf).not.toHaveBeenCalled();
  });

  it("creates a receipt, generates the PDF, and emails the member when they have an email on file", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "contribution-1", organizationId: "org-a", memberId: "member-1", amount: 100, contributionDate: new Date("2026-01-15") });
    findFirstContributionReceipt.mockResolvedValueOnce(null);
    createContributionReceipt.mockResolvedValueOnce({ id: "receipt-1", contributionId: "contribution-1", memberId: "member-1", receiptNumber: "CF-20260115-ABC123", deliveryStatus: "NOT_SENT" });
    generateAndStoreReceiptPdf.mockResolvedValueOnce({
      receipt: { id: "receipt-1", memberId: "member-1", receiptNumber: "CF-20260115-ABC123", metadata: { fileKey: "receipts/receipt-1.txt" } },
    });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", email: "member@example.com" });
    getSignedObjectUrl.mockResolvedValueOnce("https://signed.example/receipts/receipt-1.txt");

    const response = await POST(postRequest({ contributionId: "contribution-1" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(generateAndStoreReceiptPdf).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", receiptId: "receipt-1" })
    );
    expect(sendReceiptEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "member@example.com", receiptNumber: "CF-20260115-ABC123" })
    );
  });

  it("does not attempt to send an email when the receipt has no linked member", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "contribution-1", organizationId: "org-a", memberId: null, amount: 100, contributionDate: new Date("2026-01-15") });
    findFirstContributionReceipt.mockResolvedValueOnce(null);
    createContributionReceipt.mockResolvedValueOnce({ id: "receipt-1", contributionId: "contribution-1", memberId: null, receiptNumber: "CF-20260115-ABC123", deliveryStatus: "NOT_SENT" });
    generateAndStoreReceiptPdf.mockResolvedValueOnce({
      receipt: { id: "receipt-1", memberId: null, receiptNumber: "CF-20260115-ABC123", metadata: null },
    });

    const response = await POST(postRequest({ contributionId: "contribution-1" }));

    expect(response.status).toBe(201);
    expect(findFirstOrgMember).not.toHaveBeenCalled();
    expect(sendReceiptEmail).not.toHaveBeenCalled();
  });
});

describe("GET /api/receipts", () => {
  it("scopes the query to the caller's organization", async () => {
    findManyContributionReceipt.mockResolvedValueOnce([]);
    await GET();
    expect(findManyContributionReceipt).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});
