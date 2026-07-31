import { beforeEach, describe, expect, it, vi } from "vitest";

const orgMemberFindFirst = vi.fn();
const paymentImportItemFindFirst = vi.fn();
const paymentImportItemUpdate = vi.fn();
const duesChargeFindFirst = vi.fn();
const duesChargeUpdate = vi.fn();
const duesPaymentCreate = vi.fn();
const contributionCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findFirst: (...args: unknown[]) => orgMemberFindFirst(...args) },
    paymentImportItem: {
      findFirst: (...args: unknown[]) => paymentImportItemFindFirst(...args),
      update: (...args: unknown[]) => paymentImportItemUpdate(...args),
    },
    duesCharge: {
      findFirst: (...args: unknown[]) => duesChargeFindFirst(...args),
      update: (...args: unknown[]) => duesChargeUpdate(...args),
    },
    duesPayment: { create: (...args: unknown[]) => duesPaymentCreate(...args) },
    contribution: { create: (...args: unknown[]) => contributionCreate(...args) },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        duesPayment: { create: (...args: unknown[]) => duesPaymentCreate(...args) },
        duesCharge: { update: (...args: unknown[]) => duesChargeUpdate(...args) },
        paymentImportItem: { update: (...args: unknown[]) => paymentImportItemUpdate(...args) },
        contribution: { create: (...args: unknown[]) => contributionCreate(...args) },
      }),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));

import { buildPaymentImportItemData, parsePaymentCsv, postPaymentImportItem } from "@/lib/payment-reconciliation";

describe("payment-reconciliation — PAYROLL_CHECKOFF (Union thin-vertical financial adaptation)", () => {
  beforeEach(() => {
    orgMemberFindFirst.mockReset();
    paymentImportItemFindFirst.mockReset();
    paymentImportItemUpdate.mockReset();
    duesChargeFindFirst.mockReset();
    duesChargeUpdate.mockReset();
    duesPaymentCreate.mockReset();
    contributionCreate.mockReset();
  });

  describe("buildPaymentImportItemData", () => {
    it("accepts PAYROLL_CHECKOFF as a valid sourceType and maps a payroll-checkoff CSV row correctly", async () => {
      orgMemberFindFirst.mockResolvedValueOnce({ id: "member-1" });
      const row = { "Payer Email": "member1@local408.example", Amount: "$45.00", "Transaction ID": "CHECKOFF-2026-07-P1-001", Memo: "July payroll checkoff" };
      const data = await buildPaymentImportItemData("org-1", "PAYROLL_CHECKOFF", row);

      expect(data.sourceType).toBe("PAYROLL_CHECKOFF");
      expect(data.amount).toBe(45);
      expect(data.externalTransactionId).toBe("CHECKOFF-2026-07-P1-001");
      expect(data.matchedMemberId).toBe("member-1");
    });
  });

  describe("postPaymentImportItem — DUES_PAYMENT path", () => {
    it("posts a checkoff-sourced item as a DuesPayment with method PAYROLL_CHECKOFF (never a raw enum leak, never a different method)", async () => {
      paymentImportItemFindFirst.mockResolvedValueOnce({
        id: "item-1",
        organizationId: "org-1",
        sourceType: "PAYROLL_CHECKOFF",
        verificationStatus: "VERIFIED",
        postedAs: null,
        amount: 45,
        transactionDate: new Date("2026-07-15"),
        externalTransactionId: "CHECKOFF-1",
        memo: "July checkoff",
        matchedMemberId: "member-1",
      });
      orgMemberFindFirst.mockResolvedValueOnce({ id: "member-1", organizationId: "org-1" });
      duesChargeFindFirst.mockResolvedValueOnce({
        id: "charge-1",
        duesAccountId: "account-1",
        amountPaid: 0,
        amountDue: 45,
      });
      duesPaymentCreate.mockResolvedValueOnce({ id: "payment-1", amount: 45, paymentDate: new Date("2026-07-15") });

      const result = await postPaymentImportItem({
        organizationId: "org-1",
        itemId: "item-1",
        postedAs: "DUES_PAYMENT",
        duesChargeId: "charge-1",
      });

      expect(duesPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ method: "PAYROLL_CHECKOFF" }) })
      );
      expect(result.duesPayment).toEqual({ id: "payment-1", amount: 45, paymentDate: new Date("2026-07-15") });
    });

    it("updates the dues charge balance correctly and marks it PAID when the checkoff amount covers the full charge", async () => {
      paymentImportItemFindFirst.mockResolvedValueOnce({
        id: "item-1", organizationId: "org-1", sourceType: "PAYROLL_CHECKOFF", verificationStatus: "VERIFIED",
        postedAs: null, amount: 45, transactionDate: new Date(), externalTransactionId: "CHECKOFF-1", memo: null, matchedMemberId: "member-1",
      });
      orgMemberFindFirst.mockResolvedValueOnce({ id: "member-1", organizationId: "org-1" });
      duesChargeFindFirst.mockResolvedValueOnce({ id: "charge-1", duesAccountId: "account-1", amountPaid: 0, amountDue: 45 });
      duesPaymentCreate.mockResolvedValueOnce({ id: "payment-1", amount: 45, paymentDate: new Date() });

      await postPaymentImportItem({ organizationId: "org-1", itemId: "item-1", postedAs: "DUES_PAYMENT", duesChargeId: "charge-1" });

      expect(duesChargeUpdate).toHaveBeenCalledWith({
        where: { id: "charge-1" },
        data: { amountPaid: 45, status: "PAID" },
      });
    });

    it("marks the charge PARTIAL when the checkoff amount only partially covers it", async () => {
      paymentImportItemFindFirst.mockResolvedValueOnce({
        id: "item-1", organizationId: "org-1", sourceType: "PAYROLL_CHECKOFF", verificationStatus: "VERIFIED",
        postedAs: null, amount: 20, transactionDate: new Date(), externalTransactionId: "CHECKOFF-1", memo: null, matchedMemberId: "member-1",
      });
      orgMemberFindFirst.mockResolvedValueOnce({ id: "member-1", organizationId: "org-1" });
      duesChargeFindFirst.mockResolvedValueOnce({ id: "charge-1", duesAccountId: "account-1", amountPaid: 0, amountDue: 45 });
      duesPaymentCreate.mockResolvedValueOnce({ id: "payment-1", amount: 20, paymentDate: new Date() });

      await postPaymentImportItem({ organizationId: "org-1", itemId: "item-1", postedAs: "DUES_PAYMENT", duesChargeId: "charge-1" });

      expect(duesChargeUpdate).toHaveBeenCalledWith({
        where: { id: "charge-1" },
        data: { amountPaid: 20, status: "PARTIAL" },
      });
    });

    it("never resolves the member or the import item outside the caller's own organization (cross-tenant isolation)", async () => {
      paymentImportItemFindFirst.mockResolvedValueOnce(null);
      await expect(
        postPaymentImportItem({ organizationId: "org-1", itemId: "item-from-other-org", postedAs: "DUES_PAYMENT" })
      ).rejects.toThrow("Import item not found");

      expect(paymentImportItemFindFirst).toHaveBeenCalledWith({
        where: { id: "item-from-other-org", organizationId: "org-1" },
      });
    });
  });

  describe("parsePaymentCsv — fictional payroll-checkoff remittance file", () => {
    it("parses a realistic multi-row employer checkoff CSV into matchable rows", () => {
      const csv = [
        "Payer Email,Amount,Transaction ID,Memo",
        "president@local408.example,45.00,CHECKOFF-2026-07-001,July payroll checkoff",
        "member2@local408.example,45.00,CHECKOFF-2026-07-002,July payroll checkoff",
      ].join("\n");
      const rows = parsePaymentCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]["Transaction ID"]).toBe("CHECKOFF-2026-07-001");
    });
  });
});
