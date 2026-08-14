import { beforeEach, describe, expect, it, vi } from "vitest";

const countHouseholds = vi.fn();
const countAdults = vi.fn();
const findManyEvents = vi.fn();
const findManyMeetings = vi.fn();
const findFirstAssignment = vi.fn();
const findManyOpportunities = vi.fn();
const findManyPositions = vi.fn();
const findFirstTransition = vi.fn();
const findManyRequirements = vi.fn();
const countActionItems = vi.fn();
const countReimbursements = vi.fn();
const countConcerns = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { count: (...a: unknown[]) => countHouseholds(...a) },
    ptaHouseholdAdult: { count: (...a: unknown[]) => countAdults(...a) },
    event: { findMany: (...a: unknown[]) => findManyEvents(...a) },
    meeting: { findMany: (...a: unknown[]) => findManyMeetings(...a) },
    ptaOfficerAssignment: { findFirst: (...a: unknown[]) => findFirstAssignment(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
    ptaBoardPosition: { findMany: (...a: unknown[]) => findManyPositions(...a) },
    ptaBoardTransition: { findFirst: (...a: unknown[]) => findFirstTransition(...a) },
    ptaComplianceRequirement: { findMany: (...a: unknown[]) => findManyRequirements(...a) },
    meetingActionItem: { count: (...a: unknown[]) => countActionItems(...a) },
    reimbursementRequest: { count: (...a: unknown[]) => countReimbursements(...a) },
    ptaConcern: { count: (...a: unknown[]) => countConcerns(...a) },
  },
}));
vi.mock("@/lib/labs/pta/transitions", () => ({
  getTransitionDetail: vi.fn(),
  computeReadiness: vi.fn(),
  getOrgReadinessFacts: vi.fn(),
}));

import { getPtaDashboardV2 } from "@/lib/labs/pta/dashboard";

const allow = () => true;
const denyAll = () => false;

beforeEach(() => {
  vi.clearAllMocks();
  countHouseholds.mockResolvedValue(12);
  countAdults.mockResolvedValue(20);
  findManyEvents.mockResolvedValue([]);
  findManyMeetings.mockResolvedValue([]);
  findFirstAssignment.mockResolvedValue(null);
  findManyOpportunities.mockResolvedValue([]);
  findManyPositions.mockResolvedValue([]);
  findFirstTransition.mockResolvedValue(null);
  findManyRequirements.mockResolvedValue([]);
  countActionItems.mockResolvedValue(0);
  countReimbursements.mockResolvedValue(0);
  countConcerns.mockResolvedValue(0);
});

describe("getPtaDashboardV2 — §25 permission filtering", () => {
  it("a viewer with no extra permissions gets only the base metrics — guarded queries never run", async () => {
    const dashboard = await getPtaDashboardV2("org-1", "2026-2027", { userId: "u1", can: denyAll });
    const labels = dashboard.health.map((item) => item.label);
    expect(labels).toEqual(["Households", "Adults", "Volunteer needs", "Upcoming events"]);
    expect(findManyPositions).not.toHaveBeenCalled();
    expect(findManyRequirements).not.toHaveBeenCalled();
    expect(countActionItems).not.toHaveBeenCalled();
    expect(countReimbursements).not.toHaveBeenCalled();
    expect(countConcerns).not.toHaveBeenCalled();
  });

  it("grievances surface only as a count of open NON-restricted cases", async () => {
    countConcerns.mockResolvedValueOnce(2);
    const dashboard = await getPtaDashboardV2("org-1", "2026-2027", {
      userId: "u1",
      can: (permission) => permission === "pta:concerns:view",
    });
    expect(countConcerns.mock.calls[0][0].where).toMatchObject({ isRestricted: false });
    expect(dashboard.needsAttention.some((item) => item.label === "2 open concern cases")).toBe(true);
  });

  it("compliance due-soon items produce warnings with day counts and deadline entries in Upcoming", async () => {
    const dueDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    findManyRequirements.mockResolvedValueOnce([
      { title: "Bylaws review", isApplicable: true, dueDate },
      { title: "Tax filing", isApplicable: true, dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    ]);
    const dashboard = await getPtaDashboardV2("org-1", "2026-2027", {
      userId: "u1",
      can: (permission) => permission === "pta:board:view",
    });
    expect(dashboard.needsAttention.some((item) => /Bylaws review due in 10 days/.test(item.label))).toBe(true);
    expect(dashboard.needsAttention.some((item) => item.label === "Tax filing is overdue")).toBe(true);
    expect(dashboard.upcoming.some((item) => item.kind === "DEADLINE" && item.label === "Bylaws review due")).toBe(true);
    const compliance = dashboard.health.find((item) => item.label === "Compliance");
    expect(compliance?.value).toBe("1 overdue");
  });

  it("volunteer needs aggregate open spots and warn with opportunity counts", async () => {
    findManyOpportunities.mockResolvedValueOnce([
      { slots: [{ capacity: 5, claimedCount: 2 }] },
      { slots: [{ capacity: 3, claimedCount: 3 }] },
    ]);
    const dashboard = await getPtaDashboardV2("org-1", "2026-2027", { userId: "u1", can: denyAll });
    expect(dashboard.health.find((item) => item.label === "Volunteer needs")?.value).toBe("3");
    expect(dashboard.needsAttention.some((item) => item.label === "3 open volunteer spots across 1 opportunity")).toBe(true);
  });

  it("the greeting resolves the viewer's own sitting position through their adult link", async () => {
    findFirstAssignment.mockResolvedValueOnce({ position: { name: "President" } });
    const dashboard = await getPtaDashboardV2("org-1", "2026-2027", { userId: "u1", can: allow });
    expect(findFirstAssignment.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      status: "ACTIVE",
      householdAdult: { userId: "u1" },
    });
    expect(dashboard.greetingName).toBe("President");
  });

  it("overdue action items appear in health and warnings for meetings:read holders", async () => {
    countActionItems.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    const dashboard = await getPtaDashboardV2("org-1", "2026-2027", {
      userId: "u1",
      can: (permission) => permission === "meetings:read",
    });
    expect(dashboard.health.find((item) => item.label === "Open action items")?.value).toBe("5");
    expect(dashboard.needsAttention.some((item) => item.label === "2 overdue action items")).toBe(true);
  });
});
