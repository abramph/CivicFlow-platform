import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueProfile = vi.fn();
const findManyEntries = vi.fn();
const findManyOpportunities = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEntries(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
  },
}));

import { getVolunteerReport } from "@/lib/labs/pta/volunteer-reports";

function entry(minutes: number, adultId: string, adultName: string, options: { event?: string | null; committee?: string | null; startAt?: Date } = {}) {
  return {
    creditedMinutes: minutes,
    createdAt: new Date("2026-03-05T12:00:00Z"),
    signup: {
      householdAdult: { id: adultId, name: adultName },
      slot: {
        startAt: options.startAt ?? new Date("2026-03-10T15:00:00Z"),
        opportunity: {
          title: "Book Fair Helpers",
          event: options.event !== undefined ? (options.event ? { title: options.event } : null) : { title: "Book Fair" },
          committee: options.committee !== undefined ? (options.committee ? { name: options.committee } : null) : null,
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueProfile.mockResolvedValue({ currentSchoolYear: "2026-2027" });
  findManyOpportunities.mockResolvedValue([]);
});

describe("getVolunteerReport", () => {
  it("only APPROVED ledger entries for the current school year are aggregated", async () => {
    findManyEntries.mockResolvedValueOnce([]);
    await getVolunteerReport("org-1");
    expect(findManyEntries.mock.calls[0][0].where).toMatchObject({ organizationId: "org-1", status: "APPROVED", schoolYear: "2026-2027" });
  });

  it("aggregates totals, by-event, by-committee, top volunteers, and months", async () => {
    findManyEntries.mockResolvedValueOnce([
      entry(120, "a1", "Alice", { event: "Book Fair", committee: "Library" }),
      entry(60, "a2", "Bob", { event: "Book Fair" }),
      entry(30, "a1", "Alice", { event: null, startAt: new Date("2026-04-02T15:00:00Z") }),
    ]);
    const report = await getVolunteerReport("org-1");
    expect(report.totals).toEqual({ approvedMinutes: 210, approvedEntries: 3, distinctVolunteers: 2 });
    const bookFair = report.byEvent.find((row) => row.label === "Book Fair");
    expect(bookFair).toMatchObject({ minutes: 180, volunteers: 2 });
    expect(report.byCommittee).toEqual([{ label: "Library", minutes: 120, volunteers: 1 }]);
    expect(report.topVolunteers[0]).toMatchObject({ name: "Alice", minutes: 150, entries: 2 });
    expect(report.participationByMonth.map((row) => row.month)).toEqual(["2026-03", "2026-04"]);
  });

  it("unfilled opportunities report open spots from capacity minus claims", async () => {
    findManyEntries.mockResolvedValueOnce([]);
    findManyOpportunities.mockResolvedValueOnce([
      { title: "Carnival", startAt: new Date("2026-05-01"), slots: [{ capacity: 5, claimedCount: 2 }, { capacity: 2, claimedCount: 2 }] },
      { title: "Fully staffed", startAt: null, slots: [{ capacity: 3, claimedCount: 3 }] },
    ]);
    const report = await getVolunteerReport("org-1");
    expect(report.unfilledOpportunities).toEqual([
      { title: "Carnival", startAt: new Date("2026-05-01"), openSpots: 3, totalCapacity: 7 },
    ]);
  });
});
