import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyHousehold = vi.fn();
const findFirstGrade = vi.fn();
const findManyClassroom = vi.fn();
const findFirstClassroom = vi.fn();
const findManyEnrollment = vi.fn();
const findFirstEvent = vi.fn();
const findManyOpportunity = vi.fn();
const findManySignup = vi.fn();
const findFirstCommittee = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findMany: (...a: unknown[]) => findManyHousehold(...a) },
    ptaGrade: { findFirst: (...a: unknown[]) => findFirstGrade(...a) },
    ptaClassroom: { findMany: (...a: unknown[]) => findManyClassroom(...a), findFirst: (...a: unknown[]) => findFirstClassroom(...a) },
    ptaStudentEnrollment: { findMany: (...a: unknown[]) => findManyEnrollment(...a) },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunity(...a) },
    ptaVolunteerSignup: { findMany: (...a: unknown[]) => findManySignup(...a) },
    // getCommitteeTargetMemberIds (committees.ts) is NOT mocked -- the
    // "committee" rule delegates to the real implementation, which hits
    // this same mocked prisma client, so committee-specific behavior
    // (chair/co-chair inclusion, cross-tenant rejection) only needs to be
    // proven once, in committees.test.ts. Here we only prove the delegation
    // itself works.
    ptaCommittee: { findFirst: (...a: unknown[]) => findFirstCommittee(...a) },
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("resolvePtaTargetMemberIds — grade targeting", () => {
  it("resolves grade targeting to the OrgMember ids of enrolled students' households, deduplicated", async () => {
    findFirstGrade.mockResolvedValueOnce({ id: "grade-1", organizationId: "org-a" });
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

  it("throws PTA_GRADE_NOT_FOUND for a cross-tenant grade id, rather than silently returning an empty list", async () => {
    findFirstGrade.mockResolvedValueOnce(null);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await expect(resolvePtaTargetMemberIds("org-b", { type: "grade", gradeId: "grade-belonging-to-org-a", schoolYear: "2026-2027" })).rejects.toMatchObject({
      code: "PTA_GRADE_NOT_FOUND",
    });
    expect(findManyClassroom).not.toHaveBeenCalled();
  });

  it("excludes an inactive student and a deactivated household even if their enrollment row is still ACTIVE", async () => {
    findFirstGrade.mockResolvedValueOnce({ id: "grade-1", organizationId: "org-a" });
    findManyClassroom.mockResolvedValueOnce([{ id: "classroom-1" }]);
    findManyEnrollment.mockResolvedValueOnce([]); // the DB-level filter is what's under test, not the in-memory result
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await resolvePtaTargetMemberIds("org-a", { type: "grade", gradeId: "grade-1", schoolYear: "2026-2027" });

    expect(findManyEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ student: { status: "ACTIVE", household: { status: "ACTIVE" } } }) })
    );
  });

  it("returns an empty array (not a crash) for a grade with zero classrooms", async () => {
    findFirstGrade.mockResolvedValueOnce({ id: "grade-1", organizationId: "org-a" });
    findManyClassroom.mockResolvedValueOnce([]);
    findManyEnrollment.mockResolvedValueOnce([]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await expect(resolvePtaTargetMemberIds("org-a", { type: "grade", gradeId: "grade-1", schoolYear: "2026-2027" })).resolves.toEqual([]);
  });
});

describe("resolvePtaTargetMemberIds — classroom targeting", () => {
  it("resolves classroom targeting to enrolled students' household member ids, deduplicated", async () => {
    findFirstClassroom.mockResolvedValueOnce({ id: "classroom-1", organizationId: "org-a" });
    findManyEnrollment.mockResolvedValueOnce([
      { student: { household: { orgMemberId: "member-1" } } },
      { student: { household: { orgMemberId: "member-1" } } },
    ]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "classroom", classroomId: "classroom-1", schoolYear: "2026-2027" });
    expect(ids).toEqual(["member-1"]);
  });

  it("throws PTA_CLASSROOM_NOT_FOUND for a cross-tenant classroom id", async () => {
    findFirstClassroom.mockResolvedValueOnce(null);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await expect(
      resolvePtaTargetMemberIds("org-b", { type: "classroom", classroomId: "classroom-belonging-to-org-a", schoolYear: "2026-2027" })
    ).rejects.toMatchObject({ code: "PTA_CLASSROOM_NOT_FOUND" });
    expect(findManyEnrollment).not.toHaveBeenCalled();
  });
});

describe("resolvePtaTargetMemberIds — committee targeting", () => {
  it("delegates to the real getCommitteeTargetMemberIds implementation", async () => {
    findFirstCommittee.mockResolvedValueOnce({
      id: "committee-1",
      organizationId: "org-a",
      chair: null,
      coChair: null,
      members: [{ householdAdult: { household: { orgMemberId: "member-1" } } }],
    });
    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "committee", committeeId: "committee-1" });
    expect(ids).toEqual(["member-1"]);
  });

  it("propagates PTA_COMMITTEE_NOT_FOUND for a cross-tenant committee id", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await expect(resolvePtaTargetMemberIds("org-b", { type: "committee", committeeId: "committee-belonging-to-org-a" })).rejects.toMatchObject({
      code: "PTA_COMMITTEE_NOT_FOUND",
    });
  });
});

describe("resolvePtaTargetMemberIds — event volunteer targeting", () => {
  it("resolves to only currently SIGNED_UP household adults' member ids across every opportunity tied to the event", async () => {
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a" });
    findManyOpportunity.mockResolvedValueOnce([{ id: "opp-1" }, { id: "opp-2" }]);
    findManySignup.mockResolvedValueOnce([
      { householdAdult: { household: { orgMemberId: "member-1" } } },
      { householdAdult: { household: { orgMemberId: "member-2" } } },
    ]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "volunteers_for_event", eventId: "event-1" });

    expect(ids.sort()).toEqual(["member-1", "member-2"]);
    expect(findManyOpportunity).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", eventId: "event-1" } }));
    expect(findManySignup).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", status: "SIGNED_UP", slot: { opportunityId: { in: ["opp-1", "opp-2"] } } } })
    );
  });

  it("throws PTA_EVENT_NOT_FOUND for a cross-tenant event id", async () => {
    findFirstEvent.mockResolvedValueOnce(null);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await expect(resolvePtaTargetMemberIds("org-b", { type: "volunteers_for_event", eventId: "event-belonging-to-org-a" })).rejects.toMatchObject({
      code: "PTA_EVENT_NOT_FOUND",
    });
    expect(findManyOpportunity).not.toHaveBeenCalled();
  });

  it("returns an empty array for an event with zero volunteer opportunities", async () => {
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a" });
    findManyOpportunity.mockResolvedValueOnce([]);
    findManySignup.mockResolvedValueOnce([]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await expect(resolvePtaTargetMemberIds("org-a", { type: "volunteers_for_event", eventId: "event-1" })).resolves.toEqual([]);
    expect(findManySignup).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ slot: { opportunityId: { in: [] } } }) }));
  });

  it("excludes cancelled signups, only counting status SIGNED_UP", async () => {
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a" });
    findManyOpportunity.mockResolvedValueOnce([{ id: "opp-1" }]);
    findManySignup.mockResolvedValueOnce([{ householdAdult: { household: { orgMemberId: "member-1" } } }]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await resolvePtaTargetMemberIds("org-a", { type: "volunteers_for_event", eventId: "event-1" });
    expect(findManySignup).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "SIGNED_UP" }) }));
  });
});

describe("resolvePtaTargetMemberIds — unpaid dues targeting", () => {
  it("resolves to households with a PENDING or PARTIAL dues charge, deduplicated", async () => {
    findManyHousehold.mockResolvedValueOnce([{ orgMemberId: "member-1" }, { orgMemberId: "member-1" }]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    const ids = await resolvePtaTargetMemberIds("org-a", { type: "unpaid", schoolYear: "2026-2027" });
    expect(ids).toEqual(["member-1"]);
    expect(findManyHousehold).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-a",
          status: "ACTIVE",
          orgMember: { duesCharges: { some: { organizationId: "org-a", status: { in: ["PENDING", "PARTIAL"] } } } },
        }),
      })
    );
  });

  it("returns an empty array when no household has an outstanding charge", async () => {
    findManyHousehold.mockResolvedValueOnce([]);
    const { resolvePtaTargetMemberIds } = await import("../communications");
    await expect(resolvePtaTargetMemberIds("org-a", { type: "unpaid", schoolYear: "2026-2027" })).resolves.toEqual([]);
  });
});

describe("resolvePtaTargetMemberIds — cross-cutting", () => {
  it("never returns a student name, only OrgMember ids — the id list is the only thing fed into the existing communications pipeline", async () => {
    findFirstGrade.mockResolvedValueOnce({ id: "grade-1", organizationId: "org-a" });
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
