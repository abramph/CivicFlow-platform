import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyDuesCharge = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    duesCharge: { findMany: (...args: unknown[]) => findManyDuesCharge(...args) },
  },
}));

import { buildReport } from "@/lib/reports/report-builder";

const member = (id: string) => ({
  id,
  firstName: "Test",
  lastName: id,
  preferredName: null,
  email: null,
  phone: null,
  joinDate: null,
  membershipCategory: null,
});

describe("FULL_YEAR_DUES_PAID: brought-forward balance", () => {
  beforeEach(() => {
    findManyDuesCharge.mockReset();
  });

  it("includes a member whose in-period charges are fully paid and who owes nothing prior", async () => {
    findManyDuesCharge
      .mockResolvedValueOnce([
        { memberId: "m1", amountDue: 1200, amountPaid: 1200, adjustments: [], member: member("m1") },
      ])
      .mockResolvedValueOnce([]); // no prior charges

    const report = await buildReport({ organizationId: "org-a", reportType: "FULL_YEAR_DUES_PAID" });
    expect(report.rows).toHaveLength(1);
    expect(report.summary).toEqual(
      expect.arrayContaining([{ label: "Members fully paid", value: 1 }, { label: "Excluded for prior-year balance", value: 0 }])
    );
  });

  it("excludes a member whose in-period charges are covered but who still owes money from before the period", async () => {
    findManyDuesCharge
      .mockResolvedValueOnce([
        { memberId: "m1", amountDue: 1200, amountPaid: 1200, adjustments: [], member: member("m1") },
      ])
      .mockResolvedValueOnce([
        // Unpaid charge from before the period — $50 still owed.
        { memberId: "m1", amountDue: 50, amountPaid: 0, adjustments: [] },
      ]);

    const report = await buildReport({ organizationId: "org-a", reportType: "FULL_YEAR_DUES_PAID" });
    expect(report.rows).toHaveLength(0);
    expect(report.summary).toEqual(
      expect.arrayContaining([{ label: "Members fully paid", value: 0 }, { label: "Excluded for prior-year balance", value: 1 }])
    );
  });

  it("does not exclude a member whose prior charge was itself fully paid or waived", async () => {
    findManyDuesCharge
      .mockResolvedValueOnce([
        { memberId: "m1", amountDue: 1200, amountPaid: 1200, adjustments: [], member: member("m1") },
      ])
      .mockResolvedValueOnce([
        // Prior charge fully covered by a waiver adjustment — no real debt.
        { memberId: "m1", amountDue: 50, amountPaid: 0, adjustments: [{ amount: 50 }] },
      ]);

    const report = await buildReport({ organizationId: "org-a", reportType: "FULL_YEAR_DUES_PAID" });
    expect(report.rows).toHaveLength(1);
  });

  it("never queries prior charges when there are no in-period candidates", async () => {
    findManyDuesCharge.mockResolvedValueOnce([]);

    const report = await buildReport({ organizationId: "org-a", reportType: "FULL_YEAR_DUES_PAID" });
    expect(report.rows).toHaveLength(0);
    expect(findManyDuesCharge).toHaveBeenCalledTimes(1);
  });
});
