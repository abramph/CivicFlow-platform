import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeHouseholdRequirement } from "../assignments";

const createAssignment = vi.fn();
const deleteAssignment = vi.fn();
const findManyAssignments = vi.fn();
const findFirstAssignment = vi.fn();
const findFirstHousehold = vi.fn();
const findManyHouseholds = vi.fn();
const findManyStudents = vi.fn();
const countAdults = vi.fn();
const findUniqueHousehold = vi.fn();
const findFirstSchoolYear = vi.fn();
const findManyEnrollments = vi.fn();
const findFirstDuesAccount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerRequirementAssignment: {
      create: (...a: unknown[]) => createAssignment(...a),
      delete: (...a: unknown[]) => deleteAssignment(...a),
      findMany: (...a: unknown[]) => findManyAssignments(...a),
      findFirst: (...a: unknown[]) => findFirstAssignment(...a),
    },
    ptaHousehold: {
      findFirst: (...a: unknown[]) => findFirstHousehold(...a),
      findMany: (...a: unknown[]) => findManyHouseholds(...a),
      findUnique: (...a: unknown[]) => findUniqueHousehold(...a),
    },
    ptaStudent: { findMany: (...a: unknown[]) => findManyStudents(...a) },
    ptaHouseholdAdult: { count: (...a: unknown[]) => countAdults(...a) },
    ptaSchoolYear: { findFirst: (...a: unknown[]) => findFirstSchoolYear(...a) },
    ptaStudentEnrollment: { findMany: (...a: unknown[]) => findManyEnrollments(...a) },
    duesAccount: { findFirst: (...a: unknown[]) => findFirstDuesAccount(...a) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../periods", () => ({ getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) }));

beforeEach(() => vi.clearAllMocks());

const emptyContext = {
  householdId: "hh-1",
  currentClassroomIds: [] as string[],
  currentGradeIds: [] as string[],
  membershipCategoryId: null as string | null,
  enrolledChildCount: 2,
  adultCount: 2,
};

describe("computeHouseholdRequirement — pure resolution logic", () => {
  it("falls back to the period default with STANDARD when no assignment row matches anything", () => {
    const result = computeHouseholdRequirement(1200, [], emptyContext);
    expect(result).toMatchObject({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, exempt: false });
  });

  it("never multiplies by child/adult count unless an explicit PER_CHILD/PER_ADULT row exists", () => {
    const result = computeHouseholdRequirement(1200, [], { ...emptyContext, enrolledChildCount: 4 });
    expect(result.requiredMinutes).toBe(1200); // NOT 4800
  });

  it("PER_CHILD multiplies the default by enrolled-child count", () => {
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "PER_CHILD", reason: "policy" })];
    const result = computeHouseholdRequirement(1200, rows, { ...emptyContext, enrolledChildCount: 3 });
    expect(result.requiredMinutes).toBe(3600);
  });

  it("PER_ADULT multiplies the default by adult count", () => {
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "PER_ADULT", reason: "policy" })];
    const result = computeHouseholdRequirement(1200, rows, { ...emptyContext, adultCount: 2 });
    expect(result.requiredMinutes).toBe(2400);
  });

  it("CUSTOM uses the explicit override, ignoring the period default entirely", () => {
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "CUSTOM", requiredMinutesOverride: 300, reason: "special case" })];
    const result = computeHouseholdRequirement(1200, rows, emptyContext);
    expect(result.requiredMinutes).toBe(300);
  });

  it("EXEMPT_FULL zeroes the requirement and marks exempt", () => {
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "EXEMPT_FULL", reason: "hardship" })];
    const result = computeHouseholdRequirement(1200, rows, emptyContext);
    expect(result).toMatchObject({ requiredMinutes: 0, exempt: true });
  });

  it("WAIVER with no override amount is a full waiver (zero, exempt)", () => {
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "WAIVER", reason: "board decision" })];
    const result = computeHouseholdRequirement(1200, rows, emptyContext);
    expect(result).toMatchObject({ requiredMinutes: 0, exempt: true });
  });

  it("WAIVER with an override amount is a partial waiver (not marked fully exempt)", () => {
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "WAIVER", requiredMinutesOverride: 600, reason: "partial credit" })];
    const result = computeHouseholdRequirement(1200, rows, emptyContext);
    expect(result).toMatchObject({ requiredMinutes: 600, exempt: false });
  });

  it("an active EXEMPT_TEMPORARY row (future exemptUntil) zeroes the requirement", () => {
    const future = new Date("2027-01-01");
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "EXEMPT_TEMPORARY", reason: "medical", exemptUntil: future })];
    const result = computeHouseholdRequirement(1200, rows, emptyContext, new Date("2026-06-01"));
    expect(result).toMatchObject({ requiredMinutes: 0, exempt: true });
  });

  it("an EXPIRED EXEMPT_TEMPORARY row reverts to normal resolution (falls through to default)", () => {
    const past = new Date("2026-01-01");
    const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "EXEMPT_TEMPORARY", reason: "medical", exemptUntil: past })];
    const result = computeHouseholdRequirement(1200, rows, emptyContext, new Date("2026-06-01"));
    expect(result).toMatchObject({ requiredMinutes: 1200, assignmentType: "STANDARD" });
  });

  describe("precedence order", () => {
    it("HOUSEHOLD override wins over a matching CLASSROOM scope rule", () => {
      const rows = [
        row({ scopeType: "CLASSROOM", scopeRefId: "room-1", assignmentType: "CUSTOM", requiredMinutesOverride: 500, reason: "classroom rule" }),
        row({ scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "CUSTOM", requiredMinutesOverride: 999, reason: "individual override" }),
      ];
      const result = computeHouseholdRequirement(1200, rows, { ...emptyContext, currentClassroomIds: ["room-1"] });
      expect(result.requiredMinutes).toBe(999);
      expect(result.matchedScopeType).toBe("HOUSEHOLD");
    });

    it("PROGRAM (household-tagged group) wins over CLASSROOM/GRADE/MEMBERSHIP_PLAN but loses to HOUSEHOLD", () => {
      const rows = [
        row({ scopeType: "GRADE", scopeRefId: "grade-1", assignmentType: "CUSTOM", requiredMinutesOverride: 100, reason: "grade rule" }),
        row({ scopeType: "PROGRAM", householdId: "hh-1", scopeRefId: "Robotics Club", assignmentType: "CUSTOM", requiredMinutesOverride: 200, reason: "program rule" }),
      ];
      const result = computeHouseholdRequirement(1200, rows, { ...emptyContext, currentGradeIds: ["grade-1"] });
      expect(result.requiredMinutes).toBe(200);
      expect(result.matchedScopeType).toBe("PROGRAM");
    });

    it("CLASSROOM wins over GRADE when both match", () => {
      const rows = [
        row({ scopeType: "GRADE", scopeRefId: "grade-1", assignmentType: "CUSTOM", requiredMinutesOverride: 100, reason: "grade rule" }),
        row({ scopeType: "CLASSROOM", scopeRefId: "room-1", assignmentType: "CUSTOM", requiredMinutesOverride: 200, reason: "classroom rule" }),
      ];
      const result = computeHouseholdRequirement(1200, rows, { ...emptyContext, currentClassroomIds: ["room-1"], currentGradeIds: ["grade-1"] });
      expect(result.requiredMinutes).toBe(200);
      expect(result.matchedScopeType).toBe("CLASSROOM");
    });

    it("GRADE wins over MEMBERSHIP_PLAN", () => {
      const rows = [
        row({ scopeType: "MEMBERSHIP_PLAN", scopeRefId: "cat-1", assignmentType: "CUSTOM", requiredMinutesOverride: 100, reason: "plan rule" }),
        row({ scopeType: "GRADE", scopeRefId: "grade-1", assignmentType: "CUSTOM", requiredMinutesOverride: 200, reason: "grade rule" }),
      ];
      const result = computeHouseholdRequirement(1200, rows, { ...emptyContext, currentGradeIds: ["grade-1"], membershipCategoryId: "cat-1" });
      expect(result.requiredMinutes).toBe(200);
      expect(result.matchedScopeType).toBe("GRADE");
    });

    it("MEMBERSHIP_PLAN wins over an org-wide ALL rule", () => {
      const rows = [
        row({ scopeType: "ALL", assignmentType: "CUSTOM", requiredMinutesOverride: 100, reason: "org rule" }),
        row({ scopeType: "MEMBERSHIP_PLAN", scopeRefId: "cat-1", assignmentType: "CUSTOM", requiredMinutesOverride: 200, reason: "plan rule" }),
      ];
      const result = computeHouseholdRequirement(1200, rows, { ...emptyContext, membershipCategoryId: "cat-1" });
      expect(result.requiredMinutes).toBe(200);
      expect(result.matchedScopeType).toBe("MEMBERSHIP_PLAN");
    });

    it("ALL applies when nothing more specific matches", () => {
      const rows = [row({ scopeType: "ALL", assignmentType: "CUSTOM", requiredMinutesOverride: 900, reason: "org rule" })];
      const result = computeHouseholdRequirement(1200, rows, emptyContext);
      expect(result.requiredMinutes).toBe(900);
      expect(result.matchedScopeType).toBe("ALL");
    });

    it("does not match another household's HOUSEHOLD-scoped row", () => {
      const rows = [row({ scopeType: "HOUSEHOLD", householdId: "hh-OTHER", assignmentType: "CUSTOM", requiredMinutesOverride: 1, reason: "not mine" })];
      const result = computeHouseholdRequirement(1200, rows, emptyContext);
      expect(result.requiredMinutes).toBe(1200);
      expect(result.matchedScopeType).toBeNull();
    });
  });
});

interface RowOverrides {
  scopeType: "ALL" | "MEMBERSHIP_PLAN" | "GRADE" | "CLASSROOM" | "PROGRAM" | "HOUSEHOLD";
  scopeRefId?: string | null;
  householdId?: string | null;
  assignmentType: "STANDARD" | "PER_CHILD" | "PER_ADULT" | "CUSTOM" | "REDUCED" | "EXEMPT_FULL" | "EXEMPT_TEMPORARY" | "WAIVER";
  requiredMinutesOverride?: number | null;
  reason?: string | null;
  exemptUntil?: Date | null;
}

let idCounter = 0;
function row(overrides: RowOverrides) {
  idCounter += 1;
  return {
    id: `assignment-${idCounter}`,
    scopeRefId: null,
    householdId: null,
    requiredMinutesOverride: null,
    reason: null,
    exemptUntil: null,
    ...overrides,
  };
}

describe("createAssignment — validation", () => {
  beforeEach(() => {
    getVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1" });
  });

  it("requires a reason for every non-STANDARD assignment type", async () => {
    const { createAssignment: create } = await import("../assignments");
    await expect(
      create("org-1", "period-1", { scopeType: "ALL", assignmentType: "EXEMPT_FULL" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("requires requiredMinutesOverride for CUSTOM and REDUCED", async () => {
    const { createAssignment: create } = await import("../assignments");
    await expect(
      create("org-1", "period-1", { scopeType: "ALL", assignmentType: "CUSTOM", reason: "x" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("requires a householdId for HOUSEHOLD and PROGRAM scope", async () => {
    const { createAssignment: create } = await import("../assignments");
    await expect(
      create("org-1", "period-1", { scopeType: "HOUSEHOLD", assignmentType: "STANDARD" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects a householdId on a non-household/program scope", async () => {
    const { createAssignment: create } = await import("../assignments");
    await expect(
      create("org-1", "period-1", { scopeType: "ALL", householdId: "hh-1", assignmentType: "STANDARD" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("requires an exemptUntil date for EXEMPT_TEMPORARY", async () => {
    const { createAssignment: create } = await import("../assignments");
    await expect(
      create("org-1", "period-1", { scopeType: "ALL", assignmentType: "EXEMPT_TEMPORARY", reason: "medical" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("creates a valid assignment and writes an audit event", async () => {
    findFirstHousehold.mockResolvedValue({ id: "hh-1" });
    createAssignment.mockResolvedValue({ id: "assignment-1", scopeType: "HOUSEHOLD", assignmentType: "EXEMPT_FULL", householdId: "hh-1", reason: "hardship" });
    const { createAssignment: create } = await import("../assignments");
    await create("org-1", "period-1", { scopeType: "HOUSEHOLD", householdId: "hh-1", assignmentType: "EXEMPT_FULL", reason: "hardship" }, { userId: "u1", userEmail: "a@b.com" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.assignment_created" }));
  });
});

describe("resolveHouseholdRequirement — tenant isolation (VH-I audit finding)", () => {
  beforeEach(() => {
    getVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1", requiredMinutesDefault: 1200 });
    findManyAssignments.mockResolvedValue([]);
    findManyStudents.mockResolvedValue([]);
    countAdults.mockResolvedValue(0);
    findFirstSchoolYear.mockResolvedValue(null);
  });

  it("rejects a householdId that does not belong to the calling organization, before touching any other table", async () => {
    findFirstHousehold.mockResolvedValue(null); // not found in THIS org
    const { resolveHouseholdRequirement } = await import("../assignments");
    await expect(resolveHouseholdRequirement("org-A", "period-1", "hh-belongs-to-org-B")).rejects.toMatchObject({
      code: "PTA_HOUSEHOLD_NOT_FOUND",
    });
    expect(findFirstHousehold).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "hh-belongs-to-org-B", organizationId: "org-A" } }));
    // Never reaches the household-scope-context queries for a foreign household.
    expect(findUniqueHousehold).not.toHaveBeenCalled();
  });

  it("resolves normally once the household is confirmed to belong to this organization", async () => {
    findFirstHousehold.mockResolvedValue({ id: "hh-1" });
    findUniqueHousehold.mockResolvedValue({ orgMemberId: null });
    const { resolveHouseholdRequirement } = await import("../assignments");
    await expect(resolveHouseholdRequirement("org-A", "period-1", "hh-1")).resolves.toMatchObject({ requiredMinutes: 1200 });
  });
});
