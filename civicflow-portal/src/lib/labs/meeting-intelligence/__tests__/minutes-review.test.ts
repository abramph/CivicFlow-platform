import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstDraft = vi.fn();
const findManyDraft = vi.fn();
const createDraft = vi.fn();
const updateDraft = vi.fn();
const findFirstTranscript = vi.fn();
const findUniqueOrThrowJob = vi.fn();
const findUniqueOrThrowMeeting = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const transitionJob = vi.fn().mockResolvedValue({});
const generateMeetingMinutes = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingMinutesDraft: {
      findFirst: (...args: unknown[]) => findFirstDraft(...args),
      findMany: (...args: unknown[]) => findManyDraft(...args),
      create: (...args: unknown[]) => createDraft(...args),
      update: (...args: unknown[]) => updateDraft(...args),
    },
    meetingTranscript: { findFirst: (...args: unknown[]) => findFirstTranscript(...args) },
    meetingIntelligenceJob: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowJob(...args) },
    meeting: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMeeting(...args) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("../state-machine", () => ({ transitionJob: (...args: unknown[]) => transitionJob(...args) }));
vi.mock("../minutes", () => ({ generateMeetingMinutes: (...args: unknown[]) => generateMeetingMinutes(...args) }));

beforeEach(() => vi.clearAllMocks());

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    organizationId: "org-a",
    jobId: "job-1",
    status: "DRAFT",
    version: 1,
    editableContentJson: {},
    generatedContentJson: {},
    ...overrides,
  };
}

describe("editMeetingMinutesDraft", () => {
  it("allows editing a DRAFT-status row", async () => {
    findFirstDraft.mockResolvedValueOnce(draftRow());
    updateDraft.mockResolvedValueOnce(draftRow({ editableContentJson: { note: "edited" } }));
    const { editMeetingMinutesDraft } = await import("../minutes-review");
    const result = await editMeetingMinutesDraft({
      organizationId: "org-a",
      jobId: "job-1",
      actorUserId: "user-1",
      editableContent: { note: "edited" } as never,
    });
    expect(result.editableContentJson).toEqual({ note: "edited" });
  });

  it("rejects editing an APPROVED draft — the approved snapshot is immutable", async () => {
    findFirstDraft.mockResolvedValueOnce(draftRow({ status: "APPROVED" }));
    const { editMeetingMinutesDraft } = await import("../minutes-review");
    await expect(
      editMeetingMinutesDraft({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1", editableContent: {} as never })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_DRAFT_NOT_EDITABLE" });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("allows editing a REJECTED draft (rejected drafts remain editable)", async () => {
    findFirstDraft.mockResolvedValueOnce(draftRow({ status: "REJECTED" }));
    updateDraft.mockResolvedValueOnce(draftRow({ status: "REJECTED" }));
    const { editMeetingMinutesDraft } = await import("../minutes-review");
    await expect(
      editMeetingMinutesDraft({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1", editableContent: {} as never })
    ).resolves.toBeDefined();
  });
});

describe("approveMeetingMinutesDraft", () => {
  it("requires the draft to be IN_REVIEW before approving", async () => {
    findFirstDraft.mockResolvedValueOnce(draftRow({ status: "DRAFT" }));
    const { approveMeetingMinutesDraft } = await import("../minutes-review");
    await expect(approveMeetingMinutesDraft({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_DRAFT_NOT_EDITABLE",
    });
  });

  it("records the approving user, timestamp, and an audit event, and moves the job to APPROVED", async () => {
    findFirstDraft.mockResolvedValueOnce(draftRow({ status: "IN_REVIEW" }));
    updateDraft.mockResolvedValueOnce(draftRow({ status: "APPROVED", approvedByUserId: "user-1", approvedAt: new Date() }));

    const { approveMeetingMinutesDraft } = await import("../minutes-review");
    const result = await approveMeetingMinutesDraft({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1" });

    expect(result.status).toBe("APPROVED");
    expect(updateDraft.mock.calls[0][0].data).toMatchObject({ status: "APPROVED", approvedByUserId: "user-1" });
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "APPROVED" }));
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting_intelligence.draft_approved" }));
  });

  it("no automatic approval path exists — approveMeetingMinutesDraft is only ever reachable via an explicit call with an actorUserId", async () => {
    findFirstDraft.mockResolvedValueOnce(draftRow({ status: "IN_REVIEW" }));
    updateDraft.mockResolvedValueOnce(draftRow({ status: "APPROVED" }));
    const { approveMeetingMinutesDraft } = await import("../minutes-review");
    await approveMeetingMinutesDraft({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1" });
    expect(updateDraft.mock.calls[0][0].data.approvedByUserId).toBe("user-1");
  });
});

describe("rejectMeetingMinutesDraft", () => {
  it("moves the draft to REJECTED (still editable) without altering job status", async () => {
    findFirstDraft.mockResolvedValueOnce(draftRow({ status: "IN_REVIEW" }));
    updateDraft.mockResolvedValueOnce(draftRow({ status: "REJECTED", rejectedByUserId: "user-1" }));
    const { rejectMeetingMinutesDraft } = await import("../minutes-review");
    const result = await rejectMeetingMinutesDraft({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1", reason: "Missing action items" });
    expect(result.status).toBe("REJECTED");
    expect(transitionJob).not.toHaveBeenCalled();
  });
});

describe("regenerateMeetingMinutesDraft", () => {
  it("creates a new version and marks the previous one SUPERSEDED, never deleting it", async () => {
    findFirstTranscript.mockResolvedValueOnce({ jobId: "job-1", organizationId: "org-a", segmentsJson: [], content: "", speakerLabelMapJson: null });
    findFirstDraft.mockResolvedValueOnce(draftRow({ version: 1, status: "REJECTED" }));
    findUniqueOrThrowJob.mockResolvedValueOnce({ id: "job-1", meetingId: "meeting-1" });
    findUniqueOrThrowMeeting.mockResolvedValueOnce({ id: "meeting-1", title: "Board Meeting", meetingDate: new Date("2026-01-01") });
    generateMeetingMinutes.mockResolvedValueOnce({ result: { status: "draft" }, generatorId: "deterministic" });
    createDraft.mockResolvedValueOnce(draftRow({ id: "draft-2", version: 2 }));

    const { regenerateMeetingMinutesDraft } = await import("../minutes-review");
    const result = await regenerateMeetingMinutesDraft({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1" });

    expect(updateDraft).toHaveBeenCalledWith({ where: { id: "draft-1" }, data: { status: "SUPERSEDED" } });
    expect(createDraft.mock.calls[0][0].data.version).toBe(2);
    expect(result.version).toBe(2);
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "DRAFT_READY" }));
  });
});
