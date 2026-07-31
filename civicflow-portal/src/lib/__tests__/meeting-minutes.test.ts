import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstMeeting = vi.fn();
const findFirstOrThrowMeeting = vi.fn();
const findFirstMeetingMinutes = vi.fn();
const findManyMeetingMinutes = vi.fn();
const createMeetingMinutes = vi.fn();
const updateMeetingMinutes = vi.fn();
const updateManyMeetingMinutes = vi.fn();
const findManyOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: {
      findFirst: (...args: unknown[]) => findFirstMeeting(...args),
      findFirstOrThrow: (...args: unknown[]) => findFirstOrThrowMeeting(...args),
    },
    meetingMinutes: {
      findFirst: (...args: unknown[]) => findFirstMeetingMinutes(...args),
      findMany: (...args: unknown[]) => findManyMeetingMinutes(...args),
      create: (...args: unknown[]) => createMeetingMinutes(...args),
      update: (...args: unknown[]) => updateMeetingMinutes(...args),
      updateMany: (...args: unknown[]) => updateManyMeetingMinutes(...args),
    },
    orgMember: {
      findMany: (...args: unknown[]) => findManyOrgMember(...args),
    },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        meetingMinutes: {
          update: (...args: unknown[]) => updateMeetingMinutes(...args),
          updateMany: (...args: unknown[]) => updateManyMeetingMinutes(...args),
        },
      }),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const sendPushToMember = vi.fn();
vi.mock("@/lib/push", () => ({ sendPushToMember: (...args: unknown[]) => sendPushToMember(...args) }));

const sendEmail = vi.fn();
vi.mock("@/lib/mail", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

import {
  approveMeetingMinutes,
  createMeetingMinutesDraft,
  editMeetingMinutesDraft,
  getApprovedMeetingMinutes,
  MeetingMinutesError,
  requestMeetingMinutesChanges,
  submitMeetingMinutesForReview,
} from "@/lib/meeting-minutes";

function minutesRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "minutes-1",
    organizationId: "org-a",
    meetingId: "meeting-1",
    version: 1,
    status: "DRAFT",
    title: "Board Meeting Minutes",
    bodyText: "Called to order at 7pm.",
    ...overrides,
  };
}

describe("createMeetingMinutesDraft", () => {
  beforeEach(() => {
    findFirstMeeting.mockReset();
    findFirstMeetingMinutes.mockReset();
    createMeetingMinutes.mockReset();
  });

  it("throws when the meeting doesn't belong to the caller's organization", async () => {
    findFirstMeeting.mockResolvedValueOnce(null);

    await expect(
      createMeetingMinutesDraft({ organizationId: "org-a", meetingId: "meeting-other-org", title: "T", bodyText: "B", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "MEETING_NOT_FOUND" });
    expect(createMeetingMinutes).not.toHaveBeenCalled();
  });

  it("creates version 1 when no prior version exists", async () => {
    findFirstMeeting.mockResolvedValueOnce({ id: "meeting-1", organizationId: "org-a" });
    findFirstMeetingMinutes.mockResolvedValueOnce(null);
    createMeetingMinutes.mockResolvedValueOnce(minutesRow({ version: 1 }));

    await createMeetingMinutesDraft({ organizationId: "org-a", meetingId: "meeting-1", title: "T", bodyText: "B", actorUserId: "user-1" });

    expect(createMeetingMinutes).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1, status: "DRAFT" }) })
    );
  });

  it("increments the version when the latest version is APPROVED (correcting approved minutes)", async () => {
    findFirstMeeting.mockResolvedValueOnce({ id: "meeting-1", organizationId: "org-a" });
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ version: 2, status: "APPROVED" }));
    createMeetingMinutes.mockResolvedValueOnce(minutesRow({ version: 3 }));

    await createMeetingMinutesDraft({ organizationId: "org-a", meetingId: "meeting-1", title: "T", bodyText: "B", actorUserId: "user-1" });

    expect(createMeetingMinutes).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 3 }) })
    );
  });

  it("refuses to create a second draft while one is already unfinished (DRAFT/IN_REVIEW/CHANGES_REQUESTED)", async () => {
    findFirstMeeting.mockResolvedValueOnce({ id: "meeting-1", organizationId: "org-a" });
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ version: 1, status: "IN_REVIEW" }));

    await expect(
      createMeetingMinutesDraft({ organizationId: "org-a", meetingId: "meeting-1", title: "T", bodyText: "B", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "MEETING_MINUTES_DRAFT_IN_PROGRESS" });
    expect(createMeetingMinutes).not.toHaveBeenCalled();
  });
});

describe("editMeetingMinutesDraft", () => {
  beforeEach(() => {
    findFirstMeetingMinutes.mockReset();
    updateMeetingMinutes.mockReset();
  });

  it("404s (via MeetingMinutesError) when the minutes don't belong to the caller's organization", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(null);

    await expect(
      editMeetingMinutesDraft({ organizationId: "org-a", minutesId: "minutes-other-org", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "MEETING_MINUTES_NOT_FOUND" });
  });

  it.each(["DRAFT", "CHANGES_REQUESTED"])("allows editing from status %s", async (status) => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status }));
    updateMeetingMinutes.mockResolvedValueOnce(minutesRow({ status, title: "Updated" }));

    await expect(
      editMeetingMinutesDraft({ organizationId: "org-a", minutesId: "minutes-1", title: "Updated", actorUserId: "user-1" })
    ).resolves.toMatchObject({ title: "Updated" });
  });

  it.each(["IN_REVIEW", "APPROVED", "SUPERSEDED"])("refuses to edit from status %s (immutability)", async (status) => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status }));

    await expect(
      editMeetingMinutesDraft({ organizationId: "org-a", minutesId: "minutes-1", title: "Updated", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "MEETING_MINUTES_NOT_EDITABLE" });
    expect(updateMeetingMinutes).not.toHaveBeenCalled();
  });
});

describe("submitMeetingMinutesForReview", () => {
  beforeEach(() => {
    findFirstMeetingMinutes.mockReset();
    updateMeetingMinutes.mockReset();
  });

  it.each(["DRAFT", "CHANGES_REQUESTED"])("allows submitting from status %s", async (status) => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status }));
    updateMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "IN_REVIEW" }));

    await expect(
      submitMeetingMinutesForReview({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-1" })
    ).resolves.toMatchObject({ status: "IN_REVIEW" });
  });

  it("refuses to submit an already-approved version", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "APPROVED" }));

    await expect(
      submitMeetingMinutesForReview({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-1" })
    ).rejects.toMatchObject({ code: "MEETING_MINUTES_INVALID_TRANSITION" });
  });
});

describe("requestMeetingMinutesChanges", () => {
  beforeEach(() => {
    findFirstMeetingMinutes.mockReset();
    updateMeetingMinutes.mockReset();
  });

  it("moves IN_REVIEW to CHANGES_REQUESTED and records the reason", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "IN_REVIEW" }));
    updateMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "CHANGES_REQUESTED" }));

    await requestMeetingMinutesChanges({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-2", reason: "Add attendance count." });

    expect(updateMeetingMinutes).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CHANGES_REQUESTED", changesRequestedReason: "Add attendance count." }),
      })
    );
  });

  it("refuses to request changes on a draft that isn't in review", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "DRAFT" }));

    await expect(
      requestMeetingMinutesChanges({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-2", reason: "x" })
    ).rejects.toMatchObject({ code: "MEETING_MINUTES_INVALID_TRANSITION" });
  });
});

describe("approveMeetingMinutes", () => {
  beforeEach(() => {
    findFirstMeetingMinutes.mockReset();
    findFirstOrThrowMeeting.mockReset();
    updateMeetingMinutes.mockReset();
    updateManyMeetingMinutes.mockReset().mockResolvedValue({ count: 0 });
    findManyOrgMember.mockReset().mockResolvedValue([]);
    sendPushToMember.mockReset();
    sendEmail.mockReset();
  });

  it("refuses to approve a draft that isn't in review", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "DRAFT" }));

    await expect(
      approveMeetingMinutes({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-3" })
    ).rejects.toMatchObject({ code: "MEETING_MINUTES_INVALID_TRANSITION" });
    expect(updateMeetingMinutes).not.toHaveBeenCalled();
  });

  it("approves an in-review version and supersedes any prior approved version for the same meeting", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "IN_REVIEW", version: 2 }));
    findFirstOrThrowMeeting.mockResolvedValueOnce({ id: "meeting-1", title: "Board Meeting" });
    updateMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "APPROVED", version: 2 }));

    const result = await approveMeetingMinutes({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-3" });

    expect(updateManyMeetingMinutes).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a", meetingId: "meeting-1", status: "APPROVED" },
        data: expect.objectContaining({ status: "SUPERSEDED" }),
      })
    );
    expect(result.status).toBe("APPROVED");
  });

  it("notifies every active org member by push and email (when they have one) after approval", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "IN_REVIEW" }));
    findFirstOrThrowMeeting.mockResolvedValueOnce({ id: "meeting-1", title: "Board Meeting" });
    updateMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "APPROVED" }));
    findManyOrgMember.mockResolvedValueOnce([
      { id: "member-1", email: "a@example.com" },
      { id: "member-2", email: null },
    ]);
    sendPushToMember.mockResolvedValue({ sent: 1, failed: 0 });
    sendEmail.mockResolvedValue({ sent: true });

    await approveMeetingMinutes({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-3" });

    expect(sendPushToMember).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.com" }));
  });

  it("still returns the approved minutes even if a member notification fails", async () => {
    findFirstMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "IN_REVIEW" }));
    findFirstOrThrowMeeting.mockResolvedValueOnce({ id: "meeting-1", title: "Board Meeting" });
    updateMeetingMinutes.mockResolvedValueOnce(minutesRow({ status: "APPROVED" }));
    findManyOrgMember.mockResolvedValueOnce([{ id: "member-1", email: "a@example.com" }]);
    sendPushToMember.mockRejectedValue(new Error("push provider down"));
    sendEmail.mockRejectedValue(new Error("smtp down"));

    await expect(
      approveMeetingMinutes({ organizationId: "org-a", minutesId: "minutes-1", actorUserId: "user-3" })
    ).resolves.toMatchObject({ status: "APPROVED" });
  });
});

describe("getApprovedMeetingMinutes", () => {
  it("only ever queries status APPROVED -- the member-visibility guarantee", async () => {
    findManyMeetingMinutes.mockResolvedValueOnce([]);

    await getApprovedMeetingMinutes("org-a");

    expect(findManyMeetingMinutes).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", status: "APPROVED" } })
    );
  });
});

describe("MeetingMinutesError", () => {
  it("carries a machine-readable code alongside the message", () => {
    const error = new MeetingMinutesError("SOME_CODE", "Some message");
    expect(error.code).toBe("SOME_CODE");
    expect(error.message).toBe("Some message");
    expect(error.name).toBe("MeetingMinutesError");
  });
});
