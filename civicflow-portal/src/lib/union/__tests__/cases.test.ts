import { describe, expect, it, vi, beforeEach } from "vitest";
import { toMemberSafeUnionCase, toMemberSafeUnionCaseComments, assertValidTransition, isTerminalStatus } from "../cases";

// ── Note-visibility adversarial tests (written first, per the program
// spec's explicit priority: "internal steward/officer notes must never
// leak into the member API or mobile response. Treat this as a security
// boundary and test it adversarially.") ────────────────────────────────────

describe("toMemberSafeUnionCase / toMemberSafeUnionCaseComments — note-visibility security boundary", () => {
  it("never includes an isPrivate:true comment in the member-safe payload", () => {
    const result = toMemberSafeUnionCaseComments([
      { id: "c1", body: "Internal: member seems unreliable, verify before escalating", isPrivate: true, createdAt: new Date() },
      { id: "c2", body: "Your case has been assigned to a steward.", isPrivate: false, createdAt: new Date() },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
    expect(result.some((c) => c.id === "c1")).toBe(false);
  });

  it("strips the isPrivate field itself even from member-visible comments -- the member payload shape carries no visibility metadata at all", () => {
    const result = toMemberSafeUnionCaseComments([{ id: "c1", body: "public update", isPrivate: false, createdAt: new Date() }]);
    expect(result[0]).not.toHaveProperty("isPrivate");
    expect(Object.keys(result[0]).sort()).toEqual(["body", "createdAt", "id"].sort());
  });

  it("returns an empty array when every comment on the case is internal -- the safe default is 'show nothing', never 'show something anyway'", () => {
    const result = toMemberSafeUnionCaseComments([
      { id: "c1", body: "internal note 1", isPrivate: true, createdAt: new Date() },
      { id: "c2", body: "internal note 2", isPrivate: true, createdAt: new Date() },
    ]);
    expect(result).toEqual([]);
  });

  it("a fixture with 100 internal comments and 1 public comment leaks exactly the 1 public comment -- not a fluke of small test data", () => {
    const internal = Array.from({ length: 100 }, (_, i) => ({
      id: `internal-${i}`,
      body: `confidential officer discussion #${i}`,
      isPrivate: true,
      createdAt: new Date(),
    }));
    const result = toMemberSafeUnionCaseComments([...internal, { id: "public-1", body: "public update", isPrivate: false, createdAt: new Date() }]);
    expect(result).toEqual([{ id: "public-1", body: "public update", createdAt: expect.any(Date) }]);
  });

  it("toMemberSafeUnionCase never surfaces authorUserId, contract references, or a deadline's responsibleOrgMemberId -- only whitelisted fields reach the payload", () => {
    const raw = {
      id: "case-1",
      caseNumber: 42,
      caseType: "GRIEVANCE",
      title: "Unpaid overtime",
      description: "Worked 6 hours unpaid on 2026-08-01.",
      status: "ACTIVE" as const,
      isFormalGrievance: true,
      representationRequested: true,
      incidentDate: new Date("2026-08-01"),
      openedAt: new Date("2026-08-02"),
      resolvedAt: null,
      resolutionSummary: null,
      closedAt: null,
      assignedToOrgMemberId: "rep-1",
      createdAt: new Date("2026-08-02"),
      updatedAt: new Date("2026-08-02"),
      comments: [
        { id: "c1", body: "Officer thinks the member is exaggerating -- verify timesheet before proceeding", isPrivate: true, createdAt: new Date() },
        { id: "c2", body: "We've started reviewing your timesheet.", isPrivate: false, createdAt: new Date() },
      ],
      deadlines: [
        { id: "d1", deadlineType: "MANAGEMENT_RESPONSE_DUE", description: null, dueAt: new Date("2026-09-01"), completedAt: null },
        { id: "d2", deadlineType: "FOLLOW_UP", description: "done already", dueAt: new Date("2026-08-05"), completedAt: new Date("2026-08-05") },
      ],
    };

    const result = toMemberSafeUnionCase(raw);

    expect(JSON.stringify(result)).not.toContain("exaggerating");
    expect(result.comments).toEqual([{ id: "c2", body: "We've started reviewing your timesheet.", createdAt: expect.any(Date) }]);
    // Completed deadlines are not "upcoming" -- only the open one surfaces.
    expect(result.upcomingDates).toEqual([{ id: "d1", deadlineType: "MANAGEMENT_RESPONSE_DUE", description: null, dueAt: expect.any(Date) }]);
    expect(result).not.toHaveProperty("comments.0.authorUserId");
    expect((result as unknown as Record<string, unknown>).contractReferences).toBeUndefined();
  });

  it("defaults comments and deadlines to empty arrays when omitted entirely, rather than throwing", () => {
    const result = toMemberSafeUnionCase({
      id: "case-1",
      caseNumber: 1,
      caseType: "GENERAL_ISSUE",
      title: "t",
      description: "d",
      status: "NEW",
      isFormalGrievance: false,
      representationRequested: false,
      incidentDate: null,
      openedAt: new Date(),
      resolvedAt: null,
      resolutionSummary: null,
      closedAt: null,
      assignedToOrgMemberId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.comments).toEqual([]);
    expect(result.upcomingDates).toEqual([]);
  });
});

// ── State machine ────────────────────────────────────────────────────────

describe("UnionCaseStatus state machine", () => {
  it("allows the documented happy-path progression end to end", () => {
    expect(() => assertValidTransition("NEW", "TRIAGE")).not.toThrow();
    expect(() => assertValidTransition("TRIAGE", "ASSIGNED")).not.toThrow();
    expect(() => assertValidTransition("ASSIGNED", "ACTIVE")).not.toThrow();
    expect(() => assertValidTransition("ACTIVE", "PENDING")).not.toThrow();
    expect(() => assertValidTransition("PENDING", "RESOLVED")).not.toThrow();
    expect(() => assertValidTransition("RESOLVED", "CLOSED")).not.toThrow();
  });

  it("allows WITHDRAWN from every non-terminal status", () => {
    for (const status of ["NEW", "TRIAGE", "ASSIGNED", "ACTIVE", "PENDING"] as const) {
      expect(() => assertValidTransition(status, "WITHDRAWN")).not.toThrow();
    }
  });

  it("rejects skipping straight from NEW to RESOLVED", () => {
    expect(() => assertValidTransition("NEW", "RESOLVED")).toThrow(expect.objectContaining({ code: "UNION_CASE_INVALID_TRANSITION" }));
  });

  it("rejects any transition out of CLOSED -- terminal means terminal", () => {
    for (const to of ["NEW", "TRIAGE", "ASSIGNED", "ACTIVE", "PENDING", "RESOLVED", "WITHDRAWN"] as const) {
      expect(() => assertValidTransition("CLOSED", to)).toThrow();
    }
  });

  it("rejects any transition out of WITHDRAWN -- terminal means terminal", () => {
    for (const to of ["NEW", "TRIAGE", "ASSIGNED", "ACTIVE", "PENDING", "RESOLVED", "CLOSED"] as const) {
      expect(() => assertValidTransition("WITHDRAWN", to)).toThrow();
    }
  });

  it("allows reopening a RESOLVED case back to ACTIVE", () => {
    expect(() => assertValidTransition("RESOLVED", "ACTIVE")).not.toThrow();
  });

  it("isTerminalStatus agrees with the transition table's own dead ends", () => {
    expect(isTerminalStatus("CLOSED")).toBe(true);
    expect(isTerminalStatus("WITHDRAWN")).toBe(true);
    expect(isTerminalStatus("ACTIVE")).toBe(false);
    expect(isTerminalStatus("NEW")).toBe(false);
  });
});

// ── Service-layer writes (mocked prisma) ────────────────────────────────────

const findFirstUnionCase = vi.fn();
const updateManyUnionCase = vi.fn();
const findUniqueOrThrowUnionCase = vi.fn();
const createUnionCase = vi.fn();
const createStatusHistory = vi.fn();
const findFirstOrgMember = vi.fn();
const createAuditEvent = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        unionCase: {
          findFirst: (...a: unknown[]) => findFirstUnionCase(...a),
          updateMany: (...a: unknown[]) => updateManyUnionCase(...a),
          findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowUnionCase(...a),
          create: (...a: unknown[]) => createUnionCase(...a),
        },
        unionCaseStatusHistory: { create: (...a: unknown[]) => createStatusHistory(...a) },
      }),
    unionCase: {
      findFirst: (...a: unknown[]) => findFirstUnionCase(...a),
      updateMany: (...a: unknown[]) => updateManyUnionCase(...a),
    },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToTokens: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("transitionUnionCaseStatus — compare-and-swap", () => {
  it("rejects a concurrent update that changed the status between read and write (stale update)", async () => {
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", status: "NEW", title: "t", memberOrgMemberId: "m1" });
    updateManyUnionCase.mockResolvedValueOnce({ count: 0 });

    const { transitionUnionCaseStatus } = await import("../cases");
    await expect(
      transitionUnionCaseStatus({ organizationId: "org-a", caseId: "case-1", toStatus: "TRIAGE", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_VALIDATION_ERROR" });
  });

  it("rejects an invalid transition before ever touching the database write", async () => {
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", status: "NEW", title: "t", memberOrgMemberId: "m1" });

    const { transitionUnionCaseStatus } = await import("../cases");
    await expect(
      transitionUnionCaseStatus({ organizationId: "org-a", caseId: "case-1", toStatus: "CLOSED", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_INVALID_TRANSITION" });
    expect(updateManyUnionCase).not.toHaveBeenCalled();
  });

  it("emits the UNION_CASE_RESOLVED audit action specifically (not the generic STATUS_CHANGED) when transitioning to RESOLVED", async () => {
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", status: "ACTIVE", title: "t", memberOrgMemberId: "m1" });
    updateManyUnionCase.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrowUnionCase.mockResolvedValueOnce({ id: "case-1", status: "RESOLVED", title: "t", memberOrgMemberId: "m1" });
    findFirstOrgMember.mockResolvedValueOnce(null); // notification lookup short-circuits

    const { transitionUnionCaseStatus } = await import("../cases");
    await transitionUnionCaseStatus({ organizationId: "org-a", caseId: "case-1", toStatus: "RESOLVED", actorUserId: "u1" });

    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "UNION_CASE_RESOLVED" }));
  });

  it("never puts resolutionSummary or case description in audit metadata (no confidential narrative in the log)", async () => {
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", status: "ACTIVE", title: "t", memberOrgMemberId: "m1" });
    updateManyUnionCase.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrowUnionCase.mockResolvedValueOnce({ id: "case-1", status: "RESOLVED", title: "t", memberOrgMemberId: "m1" });
    findFirstOrgMember.mockResolvedValueOnce(null);

    const { transitionUnionCaseStatus } = await import("../cases");
    await transitionUnionCaseStatus({
      organizationId: "org-a",
      caseId: "case-1",
      toStatus: "RESOLVED",
      actorUserId: "u1",
      resolutionSummary: "Confidential settlement details the union agreed to with the employer",
    });

    const call = createAuditEvent.mock.calls.find((c) => (c[0] as { action: string }).action === "UNION_CASE_RESOLVED");
    expect(JSON.stringify(call?.[0])).not.toContain("Confidential settlement");
  });
});

describe("assignUnionCase — status bump decoupled from reassignment", () => {
  it("bumps NEW -> ASSIGNED on first assignment", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "rep-1" }); // assignee lookup
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", status: "NEW", title: "t", memberOrgMemberId: "m1" });
    updateManyUnionCase.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrowUnionCase.mockResolvedValueOnce({ id: "case-1", status: "ASSIGNED", title: "t", memberOrgMemberId: "m1" });
    findFirstOrgMember.mockResolvedValueOnce(null); // notification lookup

    const { assignUnionCase } = await import("../cases");
    await assignUnionCase({ organizationId: "org-a", caseId: "case-1", assignedToOrgMemberId: "rep-1", actorUserId: "u1" });

    expect(updateManyUnionCase).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ASSIGNED" }) }));
    expect(createStatusHistory).toHaveBeenCalledTimes(1);
  });

  it("reassigning an already-ACTIVE case only changes the assignee, leaving status untouched and writing no status-history row", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "rep-2" });
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", status: "ACTIVE", title: "t", memberOrgMemberId: "m1" });
    updateManyUnionCase.mockResolvedValueOnce({ count: 1 });
    findUniqueOrThrowUnionCase.mockResolvedValueOnce({ id: "case-1", status: "ACTIVE", title: "t", memberOrgMemberId: "m1" });
    findFirstOrgMember.mockResolvedValueOnce(null);

    const { assignUnionCase } = await import("../cases");
    await assignUnionCase({ organizationId: "org-a", caseId: "case-1", assignedToOrgMemberId: "rep-2", actorUserId: "u1" });

    expect(updateManyUnionCase).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }));
    expect(createStatusHistory).not.toHaveBeenCalled();
  });

  it("rejects assigning to a member who isn't an active member of this organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);

    const { assignUnionCase } = await import("../cases");
    await expect(
      assignUnionCase({ organizationId: "org-a", caseId: "case-1", assignedToOrgMemberId: "not-a-member", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_ASSIGNEE_NOT_FOUND" });
    expect(findFirstUnionCase).not.toHaveBeenCalled();
  });
});
