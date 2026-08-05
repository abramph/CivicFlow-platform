import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrowOrganization = vi.fn();
const findManyOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowOrganization(...a) },
    orgMember: { findMany: (...a: unknown[]) => findManyOrgMember(...a) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrThrowOrganization.mockResolvedValue({ primaryVertical: "HOA" });
  findManyOrgMember.mockResolvedValue([]);
});

const baseInput = { organizationId: "org-a" as const };

describe("buildReport — member roster types", () => {
  it("ACTIVE_MEMBER_ROSTER filters active + not delinquent, and titles with vertical terminology", async () => {
    const { buildReport } = await import("../report-builder");
    const report = await buildReport({ ...baseInput, reportType: "ACTIVE_MEMBER_ROSTER" });

    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a", membershipStatus: "active", isDelinquent: false }) })
    );
    expect(report.title).toBe("Active Residents Roster");
  });

  it("DELINQUENT_MEMBER_ROSTER filters active + delinquent and includes Outstanding Dues", async () => {
    const { buildReport } = await import("../report-builder");
    const report = await buildReport({ ...baseInput, reportType: "DELINQUENT_MEMBER_ROSTER" });

    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ membershipStatus: "active", isDelinquent: true }) })
    );
    expect(report.columns).toContain("Outstanding Dues");
    expect(report.title).toBe("Delinquent Residents Roster");
  });

  it("INACTIVE_MEMBER_ROSTER groups inactive/deactivated/suspended/pending/retired, excluding active and terminated", async () => {
    const { buildReport } = await import("../report-builder");
    const report = await buildReport({ ...baseInput, reportType: "INACTIVE_MEMBER_ROSTER" });

    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ membershipStatus: { in: ["inactive", "deactivated", "suspended", "pending", "retired"] } }),
      })
    );
    expect(report.columns).toContain("Status Reason");
    expect(report.columns).toContain("Status Changed");
  });

  it("TERMINATED_MEMBER_ROSTER filters exactly terminated and surfaces the member-facing reason/date", async () => {
    findManyOrgMember.mockResolvedValueOnce([
      {
        firstName: "Sam",
        lastName: "Ito",
        membershipStatus: "terminated",
        statusChangeReason: "Resigned voluntarily",
        statusChangedAt: new Date("2026-08-01"),
        membershipCategory: null,
        dateOfBirth: null,
        gender: null,
        email: null,
        phone: null,
        city: null,
        state: null,
        zipCode: null,
        county: null,
        country: null,
        joinDate: null,
        duesCharges: [],
      },
    ]);
    const { buildReport } = await import("../report-builder");
    const report = await buildReport({ ...baseInput, reportType: "TERMINATED_MEMBER_ROSTER" });

    expect(findManyOrgMember).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ membershipStatus: "terminated" }) }));
    expect(report.rows[0]).toMatchObject({ Name: "Sam Ito", "Status Reason": "Resigned voluntarily" });
  });

  it("never leaks a caller-supplied membershipStatus filter across roster buckets", async () => {
    const { buildReport } = await import("../report-builder");
    await buildReport({ ...baseInput, reportType: "ACTIVE_MEMBER_ROSTER", filters: { membershipStatus: "terminated" } });

    // The roster's own bucket must win regardless of what the request tried to filter by.
    expect(findManyOrgMember).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ membershipStatus: "active" }) }));
  });

  it.each(["INACTIVE_MEMBER_ROSTER", "TERMINATED_MEMBER_ROSTER"] as const)(
    "%s ignores a caller-supplied delinquency filter -- it isn't part of that bucket's definition and would otherwise under-count vs. the roster's own card total",
    async (reportType) => {
      const { buildReport } = await import("../report-builder");
      await buildReport({ ...baseInput, reportType, filters: { delinquency: "delinquent" } });

      const call = findManyOrgMember.mock.calls[0][0];
      // Prisma treats an explicit `undefined` value as "omit this filter" --
      // the key may still be present (from the roster's own override), but
      // its value must not be the caller-supplied `true`.
      expect(call.where.isDelinquent).toBeUndefined();
    }
  );

  it.each([
    ["COMMUNITY", "Members"],
    ["PTA", "Households"],
    ["UNION", "Union Members"],
    ["HOA", "Residents"],
  ] as const)("uses %s vertical terminology (%s) in the roster title", async (vertical, memberPlural) => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({ primaryVertical: vertical });
    const { buildReport } = await import("../report-builder");
    const report = await buildReport({ ...baseInput, reportType: "TERMINATED_MEMBER_ROSTER" });

    expect(report.title).toBe(`Terminated ${memberPlural} Roster`);
  });
});
