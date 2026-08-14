import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstYear = vi.fn();
const findManyYears = vi.fn();
const upsertYear = vi.fn();
const findFirstTransition = vi.fn();
const findManyPositions = vi.fn();
const createTransitionRow = vi.fn();
const createHandoffRow = vi.fn();
const createManyChecklist = vi.fn();
const updateTransitionRow = vi.fn();
const findFirstHandoff = vi.fn();
const updateHandoffRow = vi.fn();
const findFirstAssignment = vi.fn();
const updateManyAssignments = vi.fn();
const updateAssignment = vi.fn();
const updateManyYears = vi.fn();
const updateYear = vi.fn();
const updateManyProfiles = vi.fn();
const findFirstChecklistItem = vi.fn();
const updateChecklistItem = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaSchoolYear: {
      findFirst: (...a: unknown[]) => findFirstYear(...a),
      findMany: (...a: unknown[]) => findManyYears(...a),
      upsert: (...a: unknown[]) => upsertYear(...a),
    },
    ptaBoardTransition: {
      findFirst: (...a: unknown[]) => findFirstTransition(...a),
      findMany: vi.fn(),
    },
    ptaBoardPosition: { findMany: (...a: unknown[]) => findManyPositions(...a) },
    ptaOfficerHandoff: {
      findFirst: (...a: unknown[]) => findFirstHandoff(...a),
      update: (...a: unknown[]) => updateHandoffRow(...a),
    },
    ptaOfficerAssignment: { findFirst: (...a: unknown[]) => findFirstAssignment(...a) },
    ptaHandoffChecklistItem: {
      findFirst: (...a: unknown[]) => findFirstChecklistItem(...a),
      update: (...a: unknown[]) => updateChecklistItem(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import {
  acceptOwnHandoff,
  checklistTemplateForPosition,
  computeReadiness,
  createTransition,
  getMyIncomingHandoff,
  setChecklistItemCompletion,
  updateHandoff,
  updateTransition,
} from "@/lib/labs/pta/transitions";

const actor = { actorUserId: "u1", actorEmail: "officer@example.org" };

function transactionRunsCallback() {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      ptaBoardTransition: {
        create: (...a: unknown[]) => createTransitionRow(...a),
        update: (...a: unknown[]) => updateTransitionRow(...a),
      },
      ptaOfficerHandoff: { create: (...a: unknown[]) => createHandoffRow(...a) },
      ptaHandoffChecklistItem: { createMany: (...a: unknown[]) => createManyChecklist(...a) },
      ptaOfficerAssignment: {
        updateMany: (...a: unknown[]) => updateManyAssignments(...a),
        update: (...a: unknown[]) => updateAssignment(...a),
      },
      ptaSchoolYear: {
        updateMany: (...a: unknown[]) => updateManyYears(...a),
        update: (...a: unknown[]) => updateYear(...a),
      },
      ptaProfile: { updateMany: (...a: unknown[]) => updateManyProfiles(...a) },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checklist templates (§13)", () => {
  it("treasurer template includes the bank transition checklist and never stores credentials", () => {
    const items = checklistTemplateForPosition("Treasurer");
    const titles = items.map((item) => item.title.toLowerCase());
    expect(titles.some((title) => title.includes("bank transition"))).toBe(true);
    expect(titles.some((title) => title.includes("transferred outside unestra"))).toBe(true);
  });

  it("committee chair positions match the chair template; unknown positions get the default", () => {
    expect(checklistTemplateForPosition("Fundraising Chair").map((i) => i.title)).toContain("Submit the committee report");
    expect(checklistTemplateForPosition("Historian").map((i) => i.title)).toContain("Write the handoff summary");
  });
});

describe("createTransition", () => {
  it("seeds one handoff per active position with the outgoing officer linked", async () => {
    findFirstYear.mockResolvedValueOnce({ id: "y1", label: "2026-2027" }); // current year
    upsertYear.mockResolvedValueOnce({ id: "y2" });
    findFirstTransition.mockResolvedValueOnce(null); // no duplicate
    findManyPositions.mockResolvedValueOnce([
      { id: "p1", name: "President", assignments: [{ id: "a1" }] },
      { id: "p2", name: "Treasurer", assignments: [] },
    ]);
    transactionRunsCallback();
    createTransitionRow.mockResolvedValueOnce({ id: "t1" });
    createHandoffRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: `h-${args.data.positionId}`, ...args.data }));

    await createTransition({ organizationId: "org-1", ...actor });

    expect(createHandoffRow).toHaveBeenCalledTimes(2);
    expect(createHandoffRow.mock.calls[0][0].data).toMatchObject({ positionId: "p1", outgoingAssignmentId: "a1" });
    expect(createHandoffRow.mock.calls[1][0].data).toMatchObject({ positionId: "p2", outgoingAssignmentId: null });
    expect(createManyChecklist).toHaveBeenCalledTimes(2);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.transition.started" }));
  });

  it("rejects a duplicate transition between the same years", async () => {
    findFirstYear.mockResolvedValueOnce({ id: "y1", label: "2026-2027" });
    upsertYear.mockResolvedValueOnce({ id: "y2" });
    findFirstTransition.mockResolvedValueOnce({ id: "existing" });
    await expect(createTransition({ organizationId: "org-1", ...actor })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});

describe("handoff acceptance (§36 workflow)", () => {
  const baseHandoff = {
    id: "h1",
    organizationId: "org-1",
    status: "IN_PROGRESS",
    incomingAssignmentId: null,
    position: { id: "p1", name: "President" },
    transition: { id: "t1", status: "HANDOFF_IN_PROGRESS" },
    checklistItems: [
      { id: "c1", isRequired: true, completedAt: new Date() },
      { id: "c2", isRequired: true, completedAt: null },
    ],
  };

  it("acceptance requires every required checklist item", async () => {
    findFirstHandoff.mockResolvedValueOnce({ ...baseHandoff, incomingAssignmentId: "inc-1" });
    await expect(updateHandoff({ organizationId: "org-1", handoffId: "h1", status: "ACCEPTED", ...actor })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("acceptance requires an incoming officer", async () => {
    findFirstHandoff.mockResolvedValueOnce({
      ...baseHandoff,
      checklistItems: [{ id: "c1", isRequired: true, completedAt: new Date() }],
    });
    await expect(updateHandoff({ organizationId: "org-1", handoffId: "h1", status: "ACCEPTED", ...actor })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("acceptance stamps acceptedAt and audits as handoff_accepted", async () => {
    findFirstHandoff.mockResolvedValueOnce({
      ...baseHandoff,
      incomingAssignmentId: "inc-1",
      checklistItems: [{ id: "c1", isRequired: true, completedAt: new Date() }],
    });
    updateHandoffRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...baseHandoff, ...args.data }));

    await updateHandoff({ organizationId: "org-1", handoffId: "h1", status: "ACCEPTED", ...actor });
    expect(updateHandoffRow.mock.calls[0][0].data.acceptedAt).toBeInstanceOf(Date);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.transition.handoff_accepted" }));
  });

  it("the incoming assignment must belong to the same position and organization", async () => {
    findFirstHandoff.mockResolvedValueOnce(baseHandoff);
    findFirstAssignment.mockResolvedValueOnce(null);
    await expect(
      updateHandoff({ organizationId: "org-1", handoffId: "h1", incomingAssignmentId: "foreign", ...actor })
    ).rejects.toMatchObject({ code: "PTA_OFFICER_ASSIGNMENT_NOT_FOUND" });
    expect(findFirstAssignment.mock.calls[0][0].where).toMatchObject({ organizationId: "org-1", positionId: "p1" });
  });

  it("a completed transition's handoffs are immutable", async () => {
    findFirstHandoff.mockResolvedValueOnce({ ...baseHandoff, transition: { id: "t1", status: "COMPLETED" } });
    await expect(updateHandoff({ organizationId: "org-1", handoffId: "h1", notes: "late edit", ...actor })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });
});

describe("checklist completion", () => {
  it("completion stamps the acting user; reopening clears it", async () => {
    findFirstChecklistItem.mockResolvedValue({
      id: "c1",
      title: "Hand over documents",
      handoff: { id: "h1", transition: { status: "PREPARING" }, position: { name: "Secretary" } },
    });
    updateChecklistItem.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c1", ...args.data }));

    await setChecklistItemCompletion({ organizationId: "org-1", itemId: "c1", completed: true, ...actor });
    expect(updateChecklistItem.mock.calls[0][0].data).toMatchObject({ completedByUserId: "u1" });
    expect(updateChecklistItem.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);

    await setChecklistItemCompletion({ organizationId: "org-1", itemId: "c1", completed: false, ...actor });
    expect(updateChecklistItem.mock.calls[1][0].data).toEqual({ completedAt: null, completedByUserId: null });
  });
});

describe("completing a transition (the ceremony)", () => {
  const completableDetail = {
    id: "t1",
    status: "ACCEPTED",
    fromSchoolYearId: "y1",
    toSchoolYearId: "y2",
    fromSchoolYear: { id: "y1", label: "2026-2027" },
    toSchoolYear: { id: "y2", label: "2027-2028" },
    handoffs: [
      {
        id: "h1",
        status: "ACCEPTED",
        position: { id: "p1", name: "President", sortOrder: 0 },
        incomingAssignment: { id: "inc-1", status: "INCOMING", personName: "Next President", householdAdult: null },
        outgoingAssignment: { id: "out-1", status: "ACTIVE", personName: "Old President", householdAdult: null },
        incomingAssignmentId: "inc-1",
        checklistItems: [],
      },
    ],
  };

  it("refuses while any handoff is not accepted", async () => {
    findFirstTransition.mockResolvedValueOnce({
      ...completableDetail,
      handoffs: [{ ...completableDetail.handoffs[0], status: "IN_PROGRESS" }],
    });
    await expect(
      updateTransition({ organizationId: "org-1", transitionId: "t1", status: "COMPLETED", ...actor })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("activates incoming officers by ENDING (never deleting) the sitting board, flips the current year, and stamps completedAt", async () => {
    findFirstTransition.mockResolvedValue(completableDetail);
    transactionRunsCallback();

    await updateTransition({ organizationId: "org-1", transitionId: "t1", status: "COMPLETED", ...actor });

    // Historical board preserved: the sitting holder is ENDED, not removed.
    expect(updateManyAssignments.mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org-1", positionId: "p1", status: "ACTIVE" },
      data: expect.objectContaining({ status: "ENDED" }),
    });
    expect(updateAssignment.mock.calls[0][0]).toMatchObject({ where: { id: "inc-1" }, data: expect.objectContaining({ status: "ACTIVE" }) });
    // Current-year flip mirrors setCurrentSchoolYear: unset others, set target, sync profile label.
    expect(updateManyYears.mock.calls[0][0].where).toMatchObject({ organizationId: "org-1", isCurrent: true });
    expect(updateYear.mock.calls[0][0]).toMatchObject({ where: { id: "y2" }, data: { isCurrent: true } });
    expect(updateManyProfiles.mock.calls[0][0].data).toEqual({ currentSchoolYear: "2027-2028" });
    expect(updateTransitionRow.mock.calls[0][0].data).toMatchObject({ status: "COMPLETED" });
    expect(updateTransitionRow.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.transition.completed" }));
  });

  it("a completed transition can never change again", async () => {
    findFirstTransition.mockResolvedValueOnce({ ...completableDetail, status: "COMPLETED" });
    await expect(
      updateTransition({ organizationId: "org-1", transitionId: "t1", status: "PREPARING", ...actor })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});

describe("self-service acceptance (PTA-J, §15)", () => {
  const ownHandoff = {
    id: "h1",
    status: "IN_PROGRESS",
    position: { id: "p1", name: "Treasurer", responsibilities: null },
    transition: { id: "t1", status: "HANDOFF_IN_PROGRESS", fromSchoolYear: { label: "2026-2027" }, toSchoolYear: { label: "2027-2028" } },
    outgoingAssignment: null,
    checklistItems: [{ id: "c1", isRequired: true, completedAt: new Date() }],
  };

  it("lookup is linkage-gated: incoming assignment must belong to the caller's own adult", async () => {
    findFirstHandoff.mockResolvedValueOnce(null);
    await getMyIncomingHandoff("org-1", "user-9");
    expect(findFirstHandoff.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      transition: { status: { not: "COMPLETED" } },
      incomingAssignment: { status: "INCOMING", householdAdult: { userId: "user-9" } },
    });
  });

  it("accepting your own position requires the outgoing officer's required items to be done", async () => {
    findFirstHandoff.mockResolvedValueOnce({
      ...ownHandoff,
      checklistItems: [{ id: "c1", isRequired: true, completedAt: null }],
    });
    await expect(acceptOwnHandoff({ organizationId: "org-1", userId: "user-9" })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("acceptance stamps acceptedAt, audits with selfService, and is idempotent", async () => {
    findFirstHandoff.mockResolvedValueOnce(ownHandoff);
    updateHandoffRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...ownHandoff, ...args.data }));
    await acceptOwnHandoff({ organizationId: "org-1", userId: "user-9" });
    expect(updateHandoffRow.mock.calls[0][0].data).toMatchObject({ status: "ACCEPTED" });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pta.transition.handoff_accepted", metadata: expect.objectContaining({ selfService: true }) })
    );

    findFirstHandoff.mockResolvedValueOnce({ ...ownHandoff, status: "ACCEPTED" });
    const again = await acceptOwnHandoff({ organizationId: "org-1", userId: "user-9" });
    expect(again.status).toBe("ACCEPTED");
    expect(updateHandoffRow).toHaveBeenCalledTimes(1);
  });

  it("nobody without a live incoming assignment can accept anything", async () => {
    findFirstHandoff.mockResolvedValueOnce(null);
    await expect(acceptOwnHandoff({ organizationId: "org-1", userId: "stranger" })).rejects.toMatchObject({ code: "PTA_HANDOFF_NOT_FOUND" });
  });
});

describe("readiness scoring (§12)", () => {
  it("scores per-handoff checks plus governance facts and lists completed/missing", () => {
    const report = computeReadiness(
      {
        handoffs: [
          {
            position: { name: "President" },
            incomingAssignmentId: "inc-1",
            status: "ACCEPTED",
            checklistItems: [{ isRequired: true, completedAt: new Date() }],
          },
          {
            position: { name: "Treasurer" },
            incomingAssignmentId: null,
            status: "NOT_STARTED",
            checklistItems: [{ isRequired: true, completedAt: null }],
          },
        ],
      },
      { hasCurrentBylaws: true, hasApprovedMinutes: false }
    );
    // 8 checks total: president 3/3, treasurer 0/3, bylaws 1, minutes 0.
    expect(report.score).toBe(50);
    expect(report.completed).toContain("President: handoff accepted");
    expect(report.missing).toContain("Treasurer: incoming officer identified");
    expect(report.missing).toContain("Meeting minutes approved and archived");
  });

  it("an empty transition scores zero rather than dividing by zero", () => {
    expect(computeReadiness({ handoffs: [] }, { hasCurrentBylaws: false, hasApprovedMinutes: false }).score).toBe(0);
  });
});
