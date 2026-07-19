import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganizationLabFeature = vi.fn();
vi.mock("@/lib/labs/access", () => ({
  requireOrganizationLabFeature: (...args: unknown[]) => requireOrganizationLabFeature(...args),
}));

const findFirstMeeting = vi.fn();
const createJob = vi.fn();
const findFirstJob = vi.fn();
const updateJob = vi.fn();
const findFirstTranscript = vi.fn();
const deleteTranscript = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: { findFirst: (...args: unknown[]) => findFirstMeeting(...args) },
    meetingIntelligenceJob: {
      create: (...args: unknown[]) => createJob(...args),
      findFirst: (...args: unknown[]) => findFirstJob(...args),
      update: (...args: unknown[]) => updateJob(...args),
    },
    meetingTranscript: {
      findFirst: (...args: unknown[]) => findFirstTranscript(...args),
      delete: (...args: unknown[]) => deleteTranscript(...args),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const uploadMeetingRecording = vi.fn().mockResolvedValue(undefined);
const deleteMeetingRecordingObject = vi.fn().mockResolvedValue(undefined);
vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return {
    ...actual,
    uploadMeetingRecording: (...args: unknown[]) => uploadMeetingRecording(...args),
    deleteMeetingRecordingObject: (...args: unknown[]) => deleteMeetingRecordingObject(...args),
  };
});

const fullConsent = {
  participantsNotifiedOrConsented: true,
  uploaderAuthorized: true,
  mayContainSensitiveInformation: true,
  aiRequiresHumanVerification: true,
  organizationResponsibleForRetention: true,
};

function wavBuffer() {
  const buf = Buffer.alloc(100);
  buf.write("RIFF", 0, "ascii");
  buf.write("WAVE", 8, "ascii");
  return buf;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizationLabFeature.mockResolvedValue(undefined);
});

describe("createMeetingIntelligenceJob", () => {
  it("checks Labs access before touching the database", async () => {
    requireOrganizationLabFeature.mockRejectedValueOnce(new Error("denied"));
    const { createMeetingIntelligenceJob } = await import("../jobs");
    await expect(
      createMeetingIntelligenceJob({
        organizationId: "aph-org",
        meetingId: "meeting-1",
        uploadedByUserId: "user-1",
        originalFilename: "meeting.wav",
        mimeType: "audio/wav",
        consent: fullConsent,
      })
    ).rejects.toThrow("denied");
    expect(findFirstMeeting).not.toHaveBeenCalled();
  });

  it("requires full consent confirmation before creating a job", async () => {
    const { createMeetingIntelligenceJob } = await import("../jobs");
    await expect(
      createMeetingIntelligenceJob({
        organizationId: "aph-org",
        meetingId: "meeting-1",
        uploadedByUserId: "user-1",
        originalFilename: "meeting.wav",
        mimeType: "audio/wav",
        consent: { ...fullConsent, aiRequiresHumanVerification: false },
      })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_CONSENT_REQUIRED" });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("scopes the meeting lookup by organizationId — cross-tenant meeting id is rejected", async () => {
    findFirstMeeting.mockResolvedValueOnce(null);
    const { createMeetingIntelligenceJob } = await import("../jobs");
    await expect(
      createMeetingIntelligenceJob({
        organizationId: "org-a",
        meetingId: "meeting-from-org-b",
        uploadedByUserId: "user-1",
        originalFilename: "meeting.wav",
        mimeType: "audio/wav",
        consent: fullConsent,
      })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND" });
    expect(findFirstMeeting).toHaveBeenCalledWith({ where: { id: "meeting-from-org-b", organizationId: "org-a" } });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("creates the job and advances it to UPLOAD_PENDING", async () => {
    findFirstMeeting.mockResolvedValueOnce({ id: "meeting-1", organizationId: "aph-org" });
    createJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "CREATED" });
    findFirstJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "CREATED" });
    updateJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "UPLOAD_PENDING" });

    const { createMeetingIntelligenceJob } = await import("../jobs");
    const result = await createMeetingIntelligenceJob({
      organizationId: "aph-org",
      meetingId: "meeting-1",
      uploadedByUserId: "user-1",
      originalFilename: "../../etc/passwd.wav",
      mimeType: "audio/wav",
      consent: fullConsent,
    });

    expect(result.status).toBe("UPLOAD_PENDING");
    // The dangerous path characters in the filename must be stripped before storage.
    expect(createJob.mock.calls[0][0].data.originalFilename).not.toContain("/");
  });
});

describe("uploadMeetingIntelligenceRecording", () => {
  it("rejects a job that is not currently UPLOAD_PENDING", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "UPLOADED", meetingId: "meeting-1" });
    const { uploadMeetingIntelligenceRecording } = await import("../jobs");
    await expect(
      uploadMeetingIntelligenceRecording({
        organizationId: "aph-org",
        jobId: "job-1",
        actorUserId: "user-1",
        originalFilename: "meeting.wav",
        mimeType: "audio/wav",
        buffer: wavBuffer(),
      })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_UPLOAD_NOT_FOUND" });
    expect(uploadMeetingRecording).not.toHaveBeenCalled();
  });

  it("rejects invalid file content before ever touching storage", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "UPLOAD_PENDING", meetingId: "meeting-1" });
    const { uploadMeetingIntelligenceRecording } = await import("../jobs");
    await expect(
      uploadMeetingIntelligenceRecording({
        organizationId: "aph-org",
        jobId: "job-1",
        actorUserId: "user-1",
        originalFilename: "meeting.wav",
        mimeType: "audio/wav",
        buffer: Buffer.from("not audio"),
      })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" });
    expect(uploadMeetingRecording).not.toHaveBeenCalled();
  });

  it("uploads to a key scoped under organizations/{orgId}/meeting-intelligence/{meetingId}/{jobId}/source/ and transitions to UPLOADED", async () => {
    const jobRow = { id: "job-1", organizationId: "aph-org", status: "UPLOAD_PENDING", meetingId: "meeting-1" };
    findFirstJob.mockResolvedValueOnce(jobRow); // jobs.ts's own lookup
    findFirstJob.mockResolvedValueOnce(jobRow); // transitionJob()'s internal lookup
    updateJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "UPLOADED" });

    const { uploadMeetingIntelligenceRecording } = await import("../jobs");
    await uploadMeetingIntelligenceRecording({
      organizationId: "aph-org",
      jobId: "job-1",
      actorUserId: "user-1",
      originalFilename: "meeting.wav",
      mimeType: "audio/wav",
      buffer: wavBuffer(),
    });

    expect(uploadMeetingRecording).toHaveBeenCalledTimes(1);
    const key = uploadMeetingRecording.mock.calls[0][0].key as string;
    expect(key.startsWith("organizations/aph-org/meeting-intelligence/meeting-1/job-1/source/")).toBe(true);
    expect(updateJob.mock.calls[0][0].data.status).toBe("UPLOADED");
  });
});

describe("submitMeetingIntelligenceJob", () => {
  it("rejects a job that has not been uploaded yet", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "UPLOAD_PENDING" });
    const { submitMeetingIntelligenceJob } = await import("../jobs");
    await expect(submitMeetingIntelligenceJob({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_UPLOAD_NOT_FOUND",
    });
  });

  it("transitions UPLOADED -> QUEUED", async () => {
    const jobRow = { id: "job-1", organizationId: "aph-org", status: "UPLOADED" };
    findFirstJob.mockResolvedValueOnce(jobRow);
    findFirstJob.mockResolvedValueOnce(jobRow);
    updateJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "QUEUED" });
    const { submitMeetingIntelligenceJob } = await import("../jobs");
    const result = await submitMeetingIntelligenceJob({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1" });
    expect(result.status).toBe("QUEUED");
  });
});

describe("retryMeetingIntelligenceJob", () => {
  it("rejects retrying a job that is not FAILED", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "QUEUED" });
    const { retryMeetingIntelligenceJob } = await import("../jobs");
    await expect(retryMeetingIntelligenceJob({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_INVALID_TRANSITION",
    });
  });

  it("moves a FAILED job back to QUEUED and clears the failure fields", async () => {
    const jobRow = { id: "job-1", organizationId: "aph-org", status: "FAILED" };
    findFirstJob.mockResolvedValueOnce(jobRow);
    findFirstJob.mockResolvedValueOnce(jobRow);
    updateJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "QUEUED" });

    const { retryMeetingIntelligenceJob } = await import("../jobs");
    const result = await retryMeetingIntelligenceJob({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1" });

    expect(result.status).toBe("QUEUED");
    expect(updateJob.mock.calls[0][0].data.failureCode).toBeNull();
  });
});

describe("deleteMeetingIntelligenceRecording", () => {
  it("deletes the storage object but preserves the transcript/minutes rows (only this job's status changes)", async () => {
    const jobRow = { id: "job-1", organizationId: "aph-org", status: "APPROVED", storageObjectKey: "organizations/aph-org/meeting-intelligence/m/j/source/x.wav" };
    findFirstJob.mockResolvedValueOnce(jobRow);
    findFirstJob.mockResolvedValueOnce(jobRow);
    updateJob.mockResolvedValueOnce({ id: "job-1", organizationId: "aph-org", status: "DELETED" });

    const { deleteMeetingIntelligenceRecording } = await import("../jobs");
    const result = await deleteMeetingIntelligenceRecording({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1" });

    expect(result.status).toBe("DELETED");
    expect(deleteMeetingRecordingObject).toHaveBeenCalledWith("organizations/aph-org/meeting-intelligence/m/j/source/x.wav");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting_intelligence.recording_deleted" }));
  });
});

describe("deleteMeetingIntelligenceTranscript", () => {
  it("requires explicit acknowledgement before deleting", async () => {
    const { deleteMeetingIntelligenceTranscript } = await import("../jobs");
    await expect(
      deleteMeetingIntelligenceTranscript({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1", acknowledgeRegenerationImpossible: false })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_CONSENT_REQUIRED" });
    expect(deleteTranscript).not.toHaveBeenCalled();
  });

  it("deletes only the transcript row when acknowledged, and audits it", async () => {
    findFirstTranscript.mockResolvedValueOnce({ id: "transcript-1", jobId: "job-1", organizationId: "aph-org" });
    const { deleteMeetingIntelligenceTranscript } = await import("../jobs");
    await deleteMeetingIntelligenceTranscript({ organizationId: "aph-org", jobId: "job-1", actorUserId: "user-1", acknowledgeRegenerationImpossible: true });
    expect(deleteTranscript).toHaveBeenCalledWith({ where: { id: "transcript-1" } });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "meeting_intelligence.transcript_deleted" }));
  });
});
