import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstTransition = vi.fn();
const findUniqueOrg = vi.fn();
const findManyCommittees = vi.fn();
const findManyGovernance = vi.fn();
const findManyMotions = vi.fn();
const findManyActionItems = vi.fn();
const findManyEvents = vi.fn();
const findManyMeetings = vi.fn();
const findUniqueProfile = vi.fn();
const countConcerns = vi.fn();
const findManyContacts = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaBoardTransition: { findFirst: (...a: unknown[]) => findFirstTransition(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrg(...a) },
    ptaCommittee: { findMany: (...a: unknown[]) => findManyCommittees(...a) },
    governanceDocument: { findMany: (...a: unknown[]) => findManyGovernance(...a) },
    meetingMotion: { findMany: (...a: unknown[]) => findManyMotions(...a) },
    meetingActionItem: { findMany: (...a: unknown[]) => findManyActionItems(...a) },
    event: { findMany: (...a: unknown[]) => findManyEvents(...a) },
    meeting: { findMany: (...a: unknown[]) => findManyMeetings(...a) },
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaConcern: { count: (...a: unknown[]) => countConcerns(...a) },
    organizationContact: { findMany: (...a: unknown[]) => findManyContacts(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { collectTransitionPacketData } from "@/lib/labs/pta/transition-packet";

beforeEach(() => {
  vi.clearAllMocks();
  findFirstTransition.mockResolvedValue({
    id: "t1",
    status: "HANDOFF_IN_PROGRESS",
    fromSchoolYear: { id: "y1", label: "2026-2027" },
    toSchoolYear: { id: "y2", label: "2027-2028" },
    handoffs: [
      {
        position: { id: "p1", name: "President", sortOrder: 0 },
        status: "IN_PROGRESS",
        outgoingAssignment: { personName: "Olivia Outgoing", householdAdult: null },
        incomingAssignment: null,
        incomingAssignmentId: null,
        checklistItems: [],
      },
    ],
  });
  findUniqueOrg.mockResolvedValue({ name: "Demo PTA" });
  findManyCommittees.mockResolvedValue([]);
  findManyGovernance.mockResolvedValue([]);
  findManyMotions.mockResolvedValue([]);
  findManyActionItems.mockResolvedValue([]);
  findManyEvents.mockResolvedValue([]);
  findManyMeetings.mockResolvedValue([]);
  findUniqueProfile.mockResolvedValue({ schoolOrPtaName: "Demo PTA", designation: "PTA", contactEmail: null });
  countConcerns.mockResolvedValue(3);
  findManyContacts.mockResolvedValue([]);
});

describe("transition packet confidentiality (§14)", () => {
  it("without concern permission, the packet contains no concerns section at all", async () => {
    const packet = await collectTransitionPacketData("org-1", "t1", { canViewConcerns: false });
    expect(packet.sections.some((section) => section.title === "Concerns")).toBe(false);
    expect(countConcerns).not.toHaveBeenCalled();
  });

  it("with concern permission, only a count of open NON-restricted cases appears — never titles, and restricted cases are excluded even from the count", async () => {
    const packet = await collectTransitionPacketData("org-1", "t1", { canViewConcerns: true });
    const section = packet.sections.find((s) => s.title === "Concerns");
    expect(section).toBeDefined();
    expect(section!.lines.join(" ")).toContain("Open cases (non-restricted): 3");
    expect(countConcerns.mock.calls[0][0].where).toMatchObject({ isRestricted: false });
  });

  it("board handoff lines cover every position with vacancies made explicit", async () => {
    const packet = await collectTransitionPacketData("org-1", "t1", { canViewConcerns: false });
    const board = packet.sections.find((s) => s.title === "Board handoff");
    expect(board!.lines[0]).toContain("President: Olivia Outgoing → — vacant —");
  });
});
