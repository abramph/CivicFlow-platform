import { beforeEach, describe, expect, it, vi } from "vitest";

const createPaymentReport = vi.fn();
const findFirstOrgMember = vi.fn().mockResolvedValue({ firstName: "Jane", lastName: "Doe" });
const findManyMembership = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentReport: { create: (...args: unknown[]) => createPaymentReport(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    organizationMembership: { findMany: (...args: unknown[]) => findManyMembership(...args) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: false, skipped: true }) }));

import { createPaymentReportAndNotify } from "@/lib/payment-reports";

describe("createPaymentReportAndNotify", () => {
  beforeEach(() => {
    createPaymentReport.mockReset();
    createPaymentReport.mockResolvedValue({ id: "report-1", amount: 50 });
  });

  it("defaults category to MEMBERSHIP_DUES when not specified — preserves behavior for every existing caller", async () => {
    await createPaymentReportAndNotify({
      organizationId: "org-a",
      memberId: "member-1",
      amount: 50,
      paymentMethod: "CASH",
      paymentDate: new Date(),
    });

    expect(createPaymentReport).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "MEMBERSHIP_DUES" }) })
    );
  });

  it("stores the given duesChargeId only when the category is MEMBERSHIP_DUES", async () => {
    await createPaymentReportAndNotify({
      organizationId: "org-a",
      memberId: "member-1",
      amount: 50,
      paymentMethod: "CASH",
      paymentDate: new Date(),
      category: "MEMBERSHIP_DUES",
      duesChargeId: "charge-1",
    });

    expect(createPaymentReport).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ duesChargeId: "charge-1" }) })
    );
  });

  it("ignores a duesChargeId for a non-dues category, since it isn't meaningful there", async () => {
    await createPaymentReportAndNotify({
      organizationId: "org-a",
      memberId: "member-1",
      amount: 50,
      paymentMethod: "CASH",
      paymentDate: new Date(),
      category: "DONATION",
      duesChargeId: "charge-1",
    });

    expect(createPaymentReport).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "DONATION", duesChargeId: null }) })
    );
  });
});
