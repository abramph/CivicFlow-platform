import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstMeeting = vi.fn();
const updateMeeting = vi.fn();
const findFirstAgendaItem = vi.fn();
const createAgendaItem = vi.fn();
const findFirstMotion = vi.fn();
const countMotions = vi.fn();
const txUpdateMotion = vi.fn();
const findFirstActionItem = vi.fn();
const createActionItemRow = vi.fn();
const updateActionItemRow = vi.fn();
const findFirstCommittee = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: {
      findFirst: (...a: unknown[]) => findFirstMeeting(...a),
      update: (...a: unknown[]) => updateMeeting(...a),
    },
    meetingAgendaItem: {
      findFirst: (...a: unknown[]) => findFirstAgendaItem(...a),
      create: (...a: unknown[]) => createAgendaItem(...a),
    },
    meetingMotion: {
      findFirst: (...a: unknown[]) => findFirstMotion(...a),
      create: vi.fn(),
    },
    meetingActionItem: {
      findFirst: (...a: unknown[]) => findFirstActionItem(...a),
      create: (...a: unknown[]) => createActionItemRow(...a),
      update: (...a: unknown[]) => updateActionItemRow(...a),
    },
    ptaCommittee: { findFirst: (...a: unknown[]) => findFirstCommittee(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { createActionItem, decideMotion, setMeetingStatus, updateActionItem } from "@/lib/meeting-operations";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setMeetingStatus", () => {
  it("rejects a meeting from another organization", async () => {
    findFirstMeeting.mockResolvedValueOnce(null);
    await expect(
      setMeetingStatus({ organizationId: "org-1", meetingId: "foreign", status: "COMPLETED", actorUserId: "u1" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("COMPLETED is terminal", async () => {
    findFirstMeeting.mockResolvedValueOnce({ id: "m1", status: "COMPLETED" });
    await expect(
      setMeetingStatus({ organizationId: "org-1", meetingId: "m1", status: "SCHEDULED", actorUserId: "u1" })
    ).rejects.toMatchObject({ name: "MeetingOperationError" });
    expect(updateMeeting).not.toHaveBeenCalled();
  });

  it("CANCELLED can be re-scheduled and the change is audited", async () => {
    findFirstMeeting.mockResolvedValueOnce({ id: "m1", status: "CANCELLED" });
    updateMeeting.mockResolvedValueOnce({ id: "m1", status: "SCHEDULED" });
    await setMeetingStatus({ organizationId: "org-1", meetingId: "m1", status: "SCHEDULED", actorUserId: "u1" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting.status_changed" }));
  });
});

describe("decideMotion", () => {
  function transactionRunsCallback() {
    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        meetingMotion: {
          count: (...a: unknown[]) => countMotions(...a),
          update: (...a: unknown[]) => txUpdateMotion(...a),
        },
      })
    );
  }

  it("an already-decided motion is final", async () => {
    findFirstMotion.mockResolvedValueOnce({ id: "motion-1", status: "PASSED" });
    await expect(
      decideMotion({ organizationId: "org-1", motionId: "motion-1", status: "FAILED", actorUserId: "u1" })
    ).rejects.toMatchObject({ name: "MeetingOperationError" });
  });

  it("PASSED allocates a per-org, per-year decision number", async () => {
    findFirstMotion.mockResolvedValueOnce({ id: "motion-1", status: "SECONDED", voteMethod: null, discussionNotes: null });
    countMotions.mockResolvedValueOnce(13);
    const year = new Date().getFullYear();
    txUpdateMotion.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "motion-1", ...args.data }));
    transactionRunsCallback();

    const result = await decideMotion({
      organizationId: "org-1",
      motionId: "motion-1",
      status: "PASSED",
      votesYes: 18,
      votesNo: 2,
      votesAbstain: 1,
      actorUserId: "u1",
    });

    expect(result.decisionNumber).toBe(`${year}-014`);
    expect(countMotions).toHaveBeenCalledWith({
      where: { organizationId: "org-1", decisionNumber: { startsWith: `${year}-` } },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "meeting.motion_decided", metadata: expect.objectContaining({ decisionNumber: `${year}-014` }) })
    );
  });

  it("retries number allocation on a unique-constraint collision", async () => {
    findFirstMotion.mockResolvedValueOnce({ id: "motion-1", status: "SECONDED", voteMethod: null, discussionNotes: null });
    countMotions.mockResolvedValueOnce(4).mockResolvedValueOnce(5);
    const conflict = Object.assign(new Error("unique"), { code: "P2002" });
    txUpdateMotion
      .mockRejectedValueOnce(conflict)
      .mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "motion-1", ...args.data }));
    transactionRunsCallback();

    const result = await decideMotion({ organizationId: "org-1", motionId: "motion-1", status: "PASSED", actorUserId: "u1" });
    const year = new Date().getFullYear();
    expect(result.decisionNumber).toBe(`${year}-006`);
  });

  it("FAILED motions get no decision number", async () => {
    findFirstMotion.mockResolvedValueOnce({ id: "motion-1", status: "SECONDED", voteMethod: null, discussionNotes: null });
    txUpdateMotion.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "motion-1", decisionNumber: null, ...args.data }));
    transactionRunsCallback();
    const result = await decideMotion({ organizationId: "org-1", motionId: "motion-1", status: "FAILED", actorUserId: "u1" });
    expect(result.decisionNumber ?? null).toBeNull();
    expect(countMotions).not.toHaveBeenCalled();
  });
});

describe("action items", () => {
  it("rejects a committee from another organization", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    await expect(
      createActionItem({ organizationId: "org-1", committeeId: "foreign", title: "Do a thing", actorUserId: "u1" })
    ).rejects.toMatchObject({ status: 404 });
    expect(createActionItemRow).not.toHaveBeenCalled();
  });

  it("stamps completedAt when completing, clears it when reopening", async () => {
    findFirstActionItem.mockResolvedValueOnce({ id: "item-1", status: "OPEN" });
    updateActionItemRow.mockResolvedValueOnce({ id: "item-1", status: "COMPLETED" });
    await updateActionItem({ organizationId: "org-1", actionItemId: "item-1", status: "COMPLETED", actorUserId: "u1" });
    expect(updateActionItemRow.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);

    findFirstActionItem.mockResolvedValueOnce({ id: "item-1", status: "COMPLETED" });
    updateActionItemRow.mockResolvedValueOnce({ id: "item-1", status: "OPEN" });
    await updateActionItem({ organizationId: "org-1", actionItemId: "item-1", status: "OPEN", actorUserId: "u1" });
    expect(updateActionItemRow.mock.calls[1][0].data.completedAt).toBeNull();
  });
});
