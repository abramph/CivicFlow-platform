import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstPosition = vi.fn();
const findUniquePosition = vi.fn();
const createPosition = vi.fn();
const updatePosition = vi.fn();
const createManyPositions = vi.fn();
const findFirstAdult = vi.fn();
const findFirstYear = vi.fn();
const findUniqueProfile = vi.fn();
const findFirstAssignment = vi.fn();
const txUpdateManyAssignments = vi.fn();
const txCreateAssignment = vi.fn();
const txUpdateAssignment = vi.fn();
const updateAssignment = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaBoardPosition: {
      findFirst: (...args: unknown[]) => findFirstPosition(...args),
      findUnique: (...args: unknown[]) => findUniquePosition(...args),
      create: (...args: unknown[]) => createPosition(...args),
      update: (...args: unknown[]) => updatePosition(...args),
      createMany: (...args: unknown[]) => createManyPositions(...args),
    },
    ptaHouseholdAdult: { findFirst: (...args: unknown[]) => findFirstAdult(...args) },
    ptaSchoolYear: { findFirst: (...args: unknown[]) => findFirstYear(...args) },
    ptaProfile: { findUnique: (...args: unknown[]) => findUniqueProfile(...args) },
    ptaOfficerAssignment: {
      findFirst: (...args: unknown[]) => findFirstAssignment(...args),
      update: (...args: unknown[]) => updateAssignment(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import {
  STANDARD_POSITIONS,
  activateOfficerAssignment,
  assignOfficer,
  endOfficerAssignment,
  seedStandardPositions,
} from "@/lib/labs/pta/board";

function useCallbackTransaction() {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      ptaOfficerAssignment: {
        updateMany: (...args: unknown[]) => txUpdateManyAssignments(...args),
        create: (...args: unknown[]) => txCreateAssignment(...args),
        update: (...args: unknown[]) => txUpdateAssignment(...args),
      },
    })
  );
}

beforeEach(() => {
  for (const mock of [
    findFirstPosition,
    findUniquePosition,
    createPosition,
    updatePosition,
    createManyPositions,
    findFirstAdult,
    findFirstYear,
    findUniqueProfile,
    findFirstAssignment,
    txUpdateManyAssignments,
    txCreateAssignment,
    txUpdateAssignment,
    updateAssignment,
    transaction,
  ]) {
    mock.mockReset();
  }
  createAuditEvent.mockClear();
});

describe("assignOfficer", () => {
  beforeEach(() => {
    findFirstPosition.mockResolvedValue({ id: "pos-1", organizationId: "org-1", name: "President" });
    findUniqueProfile.mockResolvedValue({ currentSchoolYear: "2026-2027" });
    txUpdateManyAssignments.mockResolvedValue({ count: 1 });
    txCreateAssignment.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "assign-2", ...args.data }));
    useCallbackTransaction();
  });

  it("requires a holder identity", async () => {
    await expect(
      assignOfficer({ organizationId: "org-1", positionId: "pos-1", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects an adult from another organization", async () => {
    findFirstAdult.mockResolvedValue(null);
    await expect(
      assignOfficer({ organizationId: "org-1", positionId: "pos-1", householdAdultId: "foreign-adult", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
  });

  it("ACTIVE assignment ends the sitting holder and creates a new history row — never deletes", async () => {
    findFirstAdult.mockResolvedValue({ id: "adult-2", organizationId: "org-1", name: "Person B" });

    const assignment = await assignOfficer({
      organizationId: "org-1",
      positionId: "pos-1",
      householdAdultId: "adult-2",
      actorUserId: "user-1",
    });

    expect(txUpdateManyAssignments).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", positionId: "pos-1", status: "ACTIVE" },
        data: expect.objectContaining({ status: "ENDED", endDate: expect.any(Date) }),
      })
    );
    expect(txCreateAssignment).toHaveBeenCalled();
    expect(assignment).toMatchObject({ householdAdultId: "adult-2", status: "ACTIVE", schoolYearLabel: "2026-2027" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.board.officer_assigned" }));
  });

  it("INCOMING assignment leaves the sitting holder untouched", async () => {
    await assignOfficer({
      organizationId: "org-1",
      positionId: "pos-1",
      personName: "Incoming Person",
      status: "INCOMING",
      actorUserId: "user-1",
    });
    expect(txUpdateManyAssignments).not.toHaveBeenCalled();
    expect(txCreateAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "INCOMING", personName: "Incoming Person" }) })
    );
  });
});

describe("endOfficerAssignment", () => {
  it("refuses to re-end an already ended term (history is never rewritten)", async () => {
    findFirstAssignment.mockResolvedValue({ id: "assign-1", status: "ENDED", position: { name: "President" } });
    await expect(
      endOfficerAssignment({ organizationId: "org-1", assignmentId: "assign-1", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(updateAssignment).not.toHaveBeenCalled();
  });

  it("ends an active term with an end date", async () => {
    findFirstAssignment.mockResolvedValue({ id: "assign-1", status: "ACTIVE", position: { name: "President" } });
    updateAssignment.mockResolvedValue({ id: "assign-1", status: "ENDED" });
    await endOfficerAssignment({ organizationId: "org-1", assignmentId: "assign-1", actorUserId: "user-1" });
    expect(updateAssignment).toHaveBeenCalledWith({
      where: { id: "assign-1" },
      data: { status: "ENDED", endDate: expect.any(Date) },
    });
  });
});

describe("activateOfficerAssignment", () => {
  it("only activates INCOMING assignments", async () => {
    findFirstAssignment.mockResolvedValue({ id: "assign-1", status: "ACTIVE", position: { id: "pos-1", name: "President" } });
    await expect(
      activateOfficerAssignment({ organizationId: "org-1", assignmentId: "assign-1", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("ends the sitting holder and promotes the incoming one", async () => {
    findFirstAssignment.mockResolvedValue({ id: "assign-2", status: "INCOMING", startDate: null, position: { id: "pos-1", name: "President" } });
    txUpdateManyAssignments.mockResolvedValue({ count: 1 });
    txUpdateAssignment.mockResolvedValue({ id: "assign-2", status: "ACTIVE" });
    useCallbackTransaction();

    await activateOfficerAssignment({ organizationId: "org-1", assignmentId: "assign-2", actorUserId: "user-1" });

    expect(txUpdateManyAssignments).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1", positionId: "pos-1", status: "ACTIVE" } })
    );
    expect(txUpdateAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "assign-2" }, data: expect.objectContaining({ status: "ACTIVE" }) })
    );
  });
});

describe("seedStandardPositions", () => {
  it("seeds idempotently via skipDuplicates and includes the classic officer set", async () => {
    createManyPositions.mockResolvedValue({ count: STANDARD_POSITIONS.length });
    await seedStandardPositions({ organizationId: "org-1", actorUserId: "user-1" });
    const call = createManyPositions.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    const names = call.data.map((position: { name: string }) => position.name);
    expect(names).toEqual(expect.arrayContaining(["President", "Vice President", "Treasurer", "Secretary"]));
    // Parliamentarian is the canonical non-voting seed.
    const parliamentarian = call.data.find((position: { name: string }) => position.name === "Parliamentarian");
    expect(parliamentarian?.isVoting).toBe(false);
  });
});
