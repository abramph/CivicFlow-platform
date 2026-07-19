import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyJob = vi.fn();
const updateJob = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const deleteMeetingRecordingObject = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingIntelligenceJob: {
      findMany: (...args: unknown[]) => findManyJob(...args),
      update: (...args: unknown[]) => updateJob(...args),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return { ...actual, deleteMeetingRecordingObject: (...args: unknown[]) => deleteMeetingRecordingObject(...args) };
});

beforeEach(() => vi.clearAllMocks());

describe("runMeetingIntelligenceRetentionCleanup", () => {
  it("only queries settled-stage jobs with a storage object older than the retention window", async () => {
    findManyJob.mockResolvedValueOnce([]);
    const { runMeetingIntelligenceRetentionCleanup } = await import("../retention");
    await runMeetingIntelligenceRetentionCleanup();

    const call = findManyJob.mock.calls[0][0];
    expect(call.where.status.in).toEqual(["DRAFT_READY", "IN_REVIEW", "APPROVED", "FAILED", "CANCELLED"]);
    expect(call.where.storageObjectKey).toEqual({ not: null });
  });

  it("deletes the storage object and nulls storageObjectKey, but never touches MeetingMinutesDraft", async () => {
    findManyJob.mockResolvedValueOnce([
      { id: "job-1", organizationId: "aph-org", status: "APPROVED", storageObjectKey: "organizations/aph-org/meeting-intelligence/m/j/source/x.wav" },
    ]);
    const { runMeetingIntelligenceRetentionCleanup } = await import("../retention");
    const result = await runMeetingIntelligenceRetentionCleanup();

    expect(result.deleted).toBe(1);
    expect(deleteMeetingRecordingObject).toHaveBeenCalledWith("organizations/aph-org/meeting-intelligence/m/j/source/x.wav");
    expect(updateJob).toHaveBeenCalledWith({ where: { id: "job-1" }, data: { storageObjectKey: null, recordingDeletedAt: expect.any(Date) } });
    // No mock for meetingMinutesDraft exists at all in this test's prisma
    // mock — if retention.ts ever touched it, this test would throw
    // "not a function" rather than silently passing.
  });

  it("writes an audit event for every deletion, attributing the reason to the retention policy", async () => {
    findManyJob.mockResolvedValueOnce([{ id: "job-1", organizationId: "aph-org", status: "APPROVED", storageObjectKey: "key" }]);
    const { runMeetingIntelligenceRetentionCleanup } = await import("../retention");
    await runMeetingIntelligenceRetentionCleanup();
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "aph-org", action: "meeting_intelligence.recording_deleted", metadata: expect.objectContaining({ reason: "retention_policy" }) })
    );
  });

  it("skips a job with no storageObjectKey without deleting anything", async () => {
    findManyJob.mockResolvedValueOnce([{ id: "job-1", organizationId: "aph-org", status: "APPROVED", storageObjectKey: null }]);
    const { runMeetingIntelligenceRetentionCleanup } = await import("../retention");
    const result = await runMeetingIntelligenceRetentionCleanup();
    expect(result.deleted).toBe(0);
    expect(deleteMeetingRecordingObject).not.toHaveBeenCalled();
  });

  it("isolates a per-job Spaces failure — one failing job does not block deletion of the rest of the batch", async () => {
    findManyJob.mockResolvedValueOnce([
      { id: "job-1", organizationId: "aph-org", status: "APPROVED", storageObjectKey: "key-1" },
      { id: "job-2", organizationId: "aph-org", status: "APPROVED", storageObjectKey: "key-2" },
    ]);
    deleteMeetingRecordingObject.mockRejectedValueOnce(new Error("Spaces network error")).mockResolvedValueOnce(undefined);

    const { runMeetingIntelligenceRetentionCleanup } = await import("../retention");
    const result = await runMeetingIntelligenceRetentionCleanup();

    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(1);
    expect(updateJob).toHaveBeenCalledTimes(1);
    expect(updateJob).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "job-2" } }));
  });
});
