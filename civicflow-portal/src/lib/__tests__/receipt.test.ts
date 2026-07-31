import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstContributionReceipt = vi.fn();
const findFirstPaymentMethodConfig = vi.fn();
const updateContributionReceipt = vi.fn();
const createAttachment = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contributionReceipt: {
      findFirst: (...args: unknown[]) => findFirstContributionReceipt(...args),
      update: (...args: unknown[]) => updateContributionReceipt(...args),
    },
    paymentMethodConfig: {
      findFirst: (...args: unknown[]) => findFirstPaymentMethodConfig(...args),
    },
    attachment: {
      create: (...args: unknown[]) => createAttachment(...args),
    },
  },
}));

const uploadBufferToSpaces = vi.fn();
vi.mock("@/lib/storage", () => ({
  buildSafeObjectKey: (prefix: string, fileName: string) => `${prefix}/2026-01-15/fixed-uuid-${fileName}`,
  uploadBufferToSpaces: (...args: unknown[]) => uploadBufferToSpaces(...args),
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { generateAndStoreReceiptPdf } from "@/lib/receipt";

function baseReceipt() {
  return {
    id: "receipt-1",
    organizationId: "org-a",
    receiptNumber: "CF-20260115-ABC123",
    metadata: null,
    organization: {
      name: "Pine Grove School PTA",
      email: "hello@pinegrovepta.example",
      phone: "555-0100",
      addressLine1: "123 Main St",
      addressLine2: null,
      city: "Springfield",
      state: "IL",
      zipCode: "62704",
    },
    contribution: {
      amount: 100,
      contributionDate: new Date("2026-01-15T00:00:00.000Z"),
      paymentMethod: "CHECK",
    },
    member: { firstName: "Casey", lastName: "Kim" },
  };
}

describe("generateAndStoreReceiptPdf", () => {
  beforeEach(() => {
    findFirstContributionReceipt.mockReset();
    findFirstPaymentMethodConfig.mockReset().mockResolvedValue(null);
    updateContributionReceipt.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...baseReceipt(),
      ...data,
    }));
    createAttachment.mockReset();
    uploadBufferToSpaces.mockReset();
  });

  it("generates a real PDF buffer, not a plain-text stub", async () => {
    findFirstContributionReceipt.mockResolvedValueOnce(baseReceipt());

    await generateAndStoreReceiptPdf({ organizationId: "org-a", receiptId: "receipt-1" });

    expect(uploadBufferToSpaces).toHaveBeenCalledTimes(1);
    const call = uploadBufferToSpaces.mock.calls[0][0];
    expect(call.contentType).toBe("application/pdf");
    // The PDF magic bytes -- proves this is a real PDF document, not text
    // dressed up with a .pdf extension.
    expect(call.buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  it("stores the object with a .pdf key and records PDF_RECEIPT format metadata", async () => {
    findFirstContributionReceipt.mockResolvedValueOnce(baseReceipt());

    const result = await generateAndStoreReceiptPdf({ organizationId: "org-a", receiptId: "receipt-1" });

    expect(result.fileKey).toMatch(/\.pdf$/);
    expect(updateContributionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ fileType: "application/pdf", format: "PDF_RECEIPT" }),
        }),
      })
    );
  });

  it("creates an Attachment record with a .pdf filename and application/pdf content type", async () => {
    findFirstContributionReceipt.mockResolvedValueOnce(baseReceipt());

    await generateAndStoreReceiptPdf({ organizationId: "org-a", receiptId: "receipt-1" });

    expect(createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: "CF-20260115-ABC123.pdf",
          contentType: "application/pdf",
        }),
      })
    );
  });

  it("throws when the receipt doesn't belong to the caller's organization", async () => {
    findFirstContributionReceipt.mockResolvedValueOnce(null);

    await expect(
      generateAndStoreReceiptPdf({ organizationId: "org-a", receiptId: "receipt-other-org" })
    ).rejects.toThrow("Receipt not found");
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
  });
});
