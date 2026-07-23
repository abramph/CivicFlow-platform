import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyHousehold = vi.fn();
const findManyClassroom = vi.fn();
const findManyEnrollment = vi.fn();
const findManySignup = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findMany: (...a: unknown[]) => findManyHousehold(...a) },
    ptaClassroom: { findMany: (...a: unknown[]) => findManyClassroom(...a) },
    ptaStudentEnrollment: { findMany: (...a: unknown[]) => findManyEnrollment(...a) },
    ptaVolunteerSignup: { findMany: (...a: unknown[]) => findManySignup(...a) },
    ptaCommitteeMember: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("resolvePtaTargetMemberIds — grade/classroom/volunteer targeting", () => {
  it("resolves grade targeting to the OrgMember ids of enrolled students' households, deduplicated", async () => {
    findManyClassroom.mockResolvedValueOnce([{ id: "classroom-1" }, { id: "classroom-2" }]);
    findManyEnrollment.mockResolvedValueOnce([
      { student: { household: { orgMemberId: "member-1" } } },
      { student: { household: { orgMemberId: "member-2" } } },
      { student: { household: { orgMemberId: "member-1" } } }, // sibling in the same household — must dedupe
    ]);

    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "grade", gradeId: "grade-1", schoolYear: "2026-2027" });

    expect(ids.sort()).toEqual(["member-1", "member-2"]);
    expect(findManyClassroom).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", gradeId: "grade-1", schoolYear: "2026-2027" } }));
  });

  it("resolves volunteers_for_event targeting to only currently SIGNED_UP household adults' member ids", async () => {
    findManySignup.mockResolvedValueOnce([{ householdAdult: { household: { orgMemberId: "member-1" } } }]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "volunteers_for_event", opportunityId: "opp-1" });

    expect(ids).toEqual(["member-1"]);
    expect(findManySignup).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", status: "SIGNED_UP", slot: { opportunityId: "opp-1" } } }));
  });

  it("never returns a student name, only OrgMember ids — the id list is the only thing fed into the existing communications pipeline", async () => {
    findManyClassroom.mockResolvedValueOnce([{ id: "classroom-1" }]);
    findManyEnrollment.mockResolvedValueOnce([{ student: { household: { orgMemberId: "member-1" } } }]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "grade", gradeId: "grade-1", schoolYear: "2026-2027" });

    for (const id of ids) {
      expect(typeof id).toBe("string");
    }
    expect(ids.every((id) => id.startsWith("member"))).toBe(true);
  });

  it("filters out null orgMemberId (a household with no billing identity yet is simply excluded, not a crash)", async () => {
    findManyHousehold.mockResolvedValueOnce([{ orgMemberId: "member-1" }, { orgMemberId: null }]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "all" });
    expect(ids).toEqual(["member-1"]);
  });
});
