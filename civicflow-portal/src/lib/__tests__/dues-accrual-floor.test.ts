import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstOrgMember = vi.fn();
const upsertOrgSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    orgSettings: { upsert: (...args: unknown[]) => upsertOrgSettings(...args) },
  },
}));

import { calculateExpectedDuesForMember } from "@/lib/dues-accrual";

// Noon UTC, deliberately not at a midnight/year boundary, so this test's
// assertions hold regardless of the machine's local timezone.
const JOIN_DATE = new Date("2018-06-15T12:00:00.000Z");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const memberWithAccount = {
  id: "member-1",
  organizationId: "org-a",
  joinDate: JOIN_DATE,
  createdAt: JOIN_DATE,
  duesAccounts: [{ id: "account-1", amountDefault: 100, frequency: "monthly" }],
};

describe("dues accrual floor (duesAccrualNotBeforeDate)", () => {
  beforeEach(() => {
    findFirstOrgMember.mockReset();
    upsertOrgSettings.mockReset();
    findFirstOrgMember.mockResolvedValue(memberWithAccount);
  });

  it("without a floor set, accrues all the way back to the member's join date", async () => {
    upsertOrgSettings.mockResolvedValue({ duesStartRule: "JOIN_DATE", duesAccrualNotBeforeDate: null });

    // Request a window starting well before the join date — accrual should
    // still floor at the join date itself, confirming the baseline
    // join-date policy behaves as expected before the new floor is involved.
    const { periods } = await calculateExpectedDuesForMember(
      "member-1",
      new Date("2010-01-01T12:00:00.000Z"),
      new Date("2018-08-01T12:00:00.000Z")
    );

    expect(periods[0].periodStart.getFullYear()).toBe(2018);
  });

  it("with a floor set, never generates a period before it — even for a member who joined years earlier", async () => {
    const floor = new Date("2026-07-04T12:00:00.000Z");
    upsertOrgSettings.mockResolvedValue({ duesStartRule: "JOIN_DATE", duesAccrualNotBeforeDate: floor });

    const { periods } = await calculateExpectedDuesForMember(
      "member-1",
      new Date("2020-01-01T12:00:00.000Z"),
      new Date("2026-12-31T12:00:00.000Z")
    );

    expect(periods.length).toBeGreaterThan(0);
    // Allow a day of slack for local-midnight rounding — the point being
    // tested is "nowhere near the 2018 join date or the 2020 request", not
    // an exact-instant match.
    expect(periods.every((period) => period.periodStart.getTime() >= floor.getTime() - ONE_DAY_MS)).toBe(true);
  });

  it("the floor applies even when the caller explicitly requests an earlier start date", async () => {
    const floor = new Date("2026-07-04T12:00:00.000Z");
    upsertOrgSettings.mockResolvedValue({ duesStartRule: "MANUAL", duesAccrualNotBeforeDate: floor });

    const { periods } = await calculateExpectedDuesForMember(
      "member-1",
      new Date("2015-01-01T12:00:00.000Z"), // explicit early request — must still be clamped
      new Date("2026-12-31T12:00:00.000Z")
    );

    expect(periods.length).toBeGreaterThan(0);
    expect(periods.every((period) => period.periodStart.getTime() >= floor.getTime() - ONE_DAY_MS)).toBe(true);
  });
});
