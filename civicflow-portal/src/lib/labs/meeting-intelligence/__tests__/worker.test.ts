import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganizationLabAccess = vi.fn();
vi.mock("@/lib/labs/access", () => ({ getOrganizationLabAccess: (...args: unknown[]) => getOrganizationLabAccess(...args) }));

const resolveOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  resolveOrganizationAccess: (...args: unknown[]) => resolveOrganizationAccess(...args),
  accessDenialMessage: (reason: string) => `Access denied: ${reason}`,
}));

const findManyJob = vi.fn();
const updateManyJob = vi.fn();
const findUniqueTranscript = vi.fn();
const findUniqueOrThrowTranscript = vi.fn();
const createTranscript = vi.fn();
const findUniqueOrThrowMeeting = vi.fn();

const { FakePrismaKnownError } = vi.hoisted(() => {
  class FakePrismaKnownError extends Error {
    code: string;
    constructor(code: string) {
      super("Prisma known request error");
      this.code = code;
    }
  }
  return { FakePrismaKnownError };
});

vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakePrismaKnownError },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingIntelligenceJob: {
      findMany: (...args: unknown[]) => findManyJob(...args),
      updateMany: (...args: unknown[]) => updateManyJob(...args),
    },
    meetingTranscript: {
      findUnique: (...args: unknown[]) => findUniqueTranscript(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowTranscript(...args),
      create: (...args: unknown[]) => createTranscript(...args),
    },
    meeting: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMeeting(...args) },
  },
}));

const transitionJob = vi.fn().mockResolvedValue({});
vi.mock("../state-machine", () => ({ transitionJob: (...args: unknown[]) => transitionJob(...args) }));

const submit = vi.fn();
const getStatus = vi.fn();
vi.mock("../providers/async-index", () => ({
  getMeetingTranscriptionProvider: () => ({ submit: (...args: unknown[]) => submit(...args), getStatus: (...args: unknown[]) => getStatus(...args) }),
}));

const getSignedRecordingUrl = vi.fn().mockResolvedValue("https://signed.example/recording.wav");
const uploadMeetingTranscriptArtifact = vi.fn().mockResolvedValue(undefined);
vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return {
    ...actual,
    getSignedRecordingUrl: (...args: unknown[]) => getSignedRecordingUrl(...args),
    uploadMeetingTranscriptArtifact: (...args: unknown[]) => uploadMeetingTranscriptArtifact(...args),
  };
});

const generateMeetingMinutes = vi.fn();
vi.mock("../minutes", () => ({ generateMeetingMinutes: (...args: unknown[]) => generateMeetingMinutes(...args) }));

const createMeetingMinutesDraft = vi.fn().mockResolvedValue({ id: "draft-1" });
vi.mock("../minutes-review", () => ({ createMeetingMinutesDraft: (...args: unknown[]) => createMeetingMinutesDraft(...args) }));

const recordTranscriptionJob = vi.fn().mockResolvedValue(undefined);
const recordAudioMinutesUploaded = vi.fn().mockResolvedValue(undefined);
const recordAudioMinutesTranscribed = vi.fn().mockResolvedValue(undefined);
const recordMinutesGenerationJob = vi.fn().mockResolvedValue(undefined);
vi.mock("../usage", () => ({
  recordTranscriptionJob: (...args: unknown[]) => recordTranscriptionJob(...args),
  recordAudioMinutesUploaded: (...args: unknown[]) => recordAudioMinutesUploaded(...args),
  recordAudioMinutesTranscribed: (...args: unknown[]) => recordAudioMinutesTranscribed(...args),
  recordMinutesGenerationJob: (...args: unknown[]) => recordMinutesGenerationJob(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationLabAccess.mockResolvedValue({ available: true });
  resolveOrganizationAccess.mockResolvedValue({ allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false });
  updateManyJob.mockResolvedValue({ count: 1 }); // claim succeeds by default
});

function queuedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    organizationId: "aph-org",
    meetingId: "meeting-1",
    provider: "assemblyai",
    storageObjectKey: "organizations/aph-org/meeting-intelligence/meeting-1/job-1/source/x.wav",
    ...overrides,
  };
}

describe("processQueuedMeetingIntelligenceJobs", () => {
  it("fails a job immediately (never submits) when Labs enrollment is no longer active", async () => {
    findManyJob.mockResolvedValueOnce([queuedJob()]);
    getOrganizationLabAccess.mockResolvedValueOnce({ available: false });

    const { processQueuedMeetingIntelligenceJobs } = await import("../worker");
    const result = await processQueuedMeetingIntelligenceJobs();

    expect(result.failed).toBe(1);
    expect(submit).not.toHaveBeenCalled();
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED", failureCode: "MEETING_INTELLIGENCE_ENROLLMENT_DISABLED" }));
  });

  it("E2E-1 finding: fails a job immediately (never submits to the paid transcription provider) when the organization's billing is inactive, even if Labs enrollment is still active", async () => {
    findManyJob.mockResolvedValueOnce([queuedJob()]);
    resolveOrganizationAccess.mockResolvedValueOnce({ allowed: false, reason: "TRIAL_EXPIRED", trialEndsAt: null, subscriptionStatus: null, billingExempt: false });

    const { processQueuedMeetingIntelligenceJobs } = await import("../worker");
    const result = await processQueuedMeetingIntelligenceJobs();

    expect(result.failed).toBe(1);
    expect(submit).not.toHaveBeenCalled();
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED", failureCode: "ORGANIZATION_SUBSCRIPTION_REQUIRED" }));
  });

  it("fails a job with a stable code when the recording object is missing", async () => {
    findManyJob.mockResolvedValueOnce([queuedJob({ storageObjectKey: null })]);
    const { processQueuedMeetingIntelligenceJobs } = await import("../worker");
    const result = await processQueuedMeetingIntelligenceJobs();
    expect(result.failed).toBe(1);
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED", failureCode: "MEETING_INTELLIGENCE_STORAGE_OBJECT_MISSING" }));
  });

  it("submits to the provider, stores the provider job id, and advances to TRANSCRIBING", async () => {
    findManyJob.mockResolvedValueOnce([queuedJob()]);
    submit.mockResolvedValueOnce({ externalJobId: "ext-1", status: "queued" });

    const { processQueuedMeetingIntelligenceJobs } = await import("../worker");
    const result = await processQueuedMeetingIntelligenceJobs();

    expect(result.submitted).toBe(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ audioUrl: "https://signed.example/recording.wav" }));
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "SUBMITTED_TO_PROVIDER", extraData: { providerJobId: "ext-1" } }));
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "TRANSCRIBING" }));
    expect(recordTranscriptionJob).toHaveBeenCalledWith("aph-org", "job-1", "assemblyai");
  });

  it("fails the job with the provider's error code when submission throws", async () => {
    findManyJob.mockResolvedValueOnce([queuedJob()]);
    const { MeetingIntelligenceError } = await import("../errors");
    submit.mockRejectedValueOnce(new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED", "rate limited"));

    const { processQueuedMeetingIntelligenceJobs } = await import("../worker");
    const result = await processQueuedMeetingIntelligenceJobs();
    expect(result.failed).toBe(1);
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED", failureCode: "MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED" }));
  });

  it("atomically claims the job (conditional UPDATE on status=QUEUED) before ever calling the provider", async () => {
    findManyJob.mockResolvedValueOnce([queuedJob()]);
    submit.mockResolvedValueOnce({ externalJobId: "ext-1", status: "queued" });

    const { processQueuedMeetingIntelligenceJobs } = await import("../worker");
    await processQueuedMeetingIntelligenceJobs();

    expect(updateManyJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1", status: "QUEUED" }),
      })
    );
    const claimCallOrder = updateManyJob.mock.invocationCallOrder[0];
    const submitCallOrder = submit.mock.invocationCallOrder[0];
    expect(claimCallOrder).toBeLessThan(submitCallOrder);
  });

  it("skips (does not submit, does not fail) a job it loses the claim race for — another concurrent invocation already claimed it", async () => {
    findManyJob.mockResolvedValueOnce([queuedJob()]);
    updateManyJob.mockResolvedValueOnce({ count: 0 });

    const { processQueuedMeetingIntelligenceJobs } = await import("../worker");
    const result = await processQueuedMeetingIntelligenceJobs();

    expect(submit).not.toHaveBeenCalled();
    expect(transitionJob).not.toHaveBeenCalled();
    expect(result.submitted).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe("pollTranscribingMeetingIntelligenceJobs", () => {
  function transcribingJob(overrides: Record<string, unknown> = {}) {
    return { id: "job-1", organizationId: "aph-org", meetingId: "meeting-1", provider: "assemblyai", providerJobId: "ext-1", ...overrides };
  }

  it("leaves the job untouched while the provider is still queued/processing", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({ status: "processing" });
    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    const result = await pollTranscribingMeetingIntelligenceJobs();
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
    expect(transitionJob).not.toHaveBeenCalled();
  });

  it("atomically claims the job (conditional UPDATE on status=TRANSCRIBING) before ever calling the provider", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({ status: "processing" });

    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    await pollTranscribingMeetingIntelligenceJobs();

    expect(updateManyJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1", status: "TRANSCRIBING" }),
      })
    );
    const claimCallOrder = updateManyJob.mock.invocationCallOrder[0];
    const getStatusCallOrder = getStatus.mock.invocationCallOrder[0];
    expect(claimCallOrder).toBeLessThan(getStatusCallOrder);
  });

  it("skips a job it loses the poll-claim race for — another concurrent invocation already claimed it — without calling the provider or any downstream step", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    updateManyJob.mockResolvedValueOnce({ count: 0 });

    // Deliberately does NOT stub getStatus's return value — the claim
    // failing must short-circuit before getStatus is ever called, so an
    // unconsumed mockResolvedValueOnce here would leak into (and corrupt)
    // whichever test runs next.
    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    const result = await pollTranscribingMeetingIntelligenceJobs();

    expect(getStatus).not.toHaveBeenCalled();
    expect(transitionJob).not.toHaveBeenCalled();
    expect(createTranscript).not.toHaveBeenCalled();
    expect(generateMeetingMinutes).not.toHaveBeenCalled();
    expect(createMeetingMinutesDraft).not.toHaveBeenCalled();
    expect(result.completed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("fails the job when the provider reports an error", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({ status: "error", errorMessage: "invalid audio" });
    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    const result = await pollTranscribingMeetingIntelligenceJobs();
    expect(result.failed).toBe(1);
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED", failureCode: "MEETING_INTELLIGENCE_TRANSCRIPTION_FAILED" }));
  });

  it("stores the transcript, generates minutes, and advances to DRAFT_READY on completion", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({
      status: "completed",
      result: { language: "en", durationMs: 600_000, fullText: "hello", segments: [{ speakerLabel: "Speaker A", startMs: 0, endMs: 1000, text: "hello" }], speakerCount: 1 },
    });
    findUniqueTranscript.mockResolvedValueOnce(null);
    findUniqueOrThrowMeeting.mockResolvedValueOnce({ id: "meeting-1", title: "Board Meeting", meetingDate: new Date("2026-01-01") });
    generateMeetingMinutes.mockResolvedValueOnce({ result: { status: "draft" }, generatorId: "deterministic" });

    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    const result = await pollTranscribingMeetingIntelligenceJobs();

    expect(result.completed).toBe(1);
    expect(createTranscript).toHaveBeenCalledTimes(1);
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "TRANSCRIBED" }));
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "GENERATING_MINUTES" }));
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "DRAFT_READY" }));
    expect(createMeetingMinutesDraft).toHaveBeenCalledTimes(1);
    expect(recordAudioMinutesTranscribed).toHaveBeenCalled();
    expect(recordMinutesGenerationJob).toHaveBeenCalled();
  });

  it("adopts the winning transcript row (instead of failing the job) when a concurrent poll created it between the existence check and the insert", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({
      status: "completed",
      result: { language: "en", durationMs: 600_000, fullText: "hello", segments: [], speakerCount: 0 },
    });
    findUniqueTranscript.mockResolvedValueOnce(null); // race: looked empty at check time
    createTranscript.mockRejectedValueOnce(new FakePrismaKnownError("P2002"));
    findUniqueOrThrowTranscript.mockResolvedValueOnce({ id: "winner-transcript" });
    findUniqueOrThrowMeeting.mockResolvedValueOnce({ id: "meeting-1", title: "Board Meeting", meetingDate: new Date("2026-01-01") });
    generateMeetingMinutes.mockResolvedValueOnce({ result: { status: "draft" }, generatorId: "deterministic" });

    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    const result = await pollTranscribingMeetingIntelligenceJobs();

    expect(result.failed).toBe(0);
    expect(findUniqueOrThrowTranscript).toHaveBeenCalledWith({ where: { jobId: "job-1" } });
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "TRANSCRIBED" }));
    expect(transitionJob).not.toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED" }));
  });

  it("does not create a second transcript row when one already exists (duplicate-submission guard)", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({
      status: "completed",
      result: { language: "en", durationMs: 600_000, fullText: "hello", segments: [], speakerCount: 0 },
    });
    findUniqueTranscript.mockResolvedValueOnce({ id: "existing-transcript" });
    findUniqueOrThrowMeeting.mockResolvedValueOnce({ id: "meeting-1", title: "Board Meeting", meetingDate: new Date("2026-01-01") });
    generateMeetingMinutes.mockResolvedValueOnce({ result: { status: "draft" }, generatorId: "deterministic" });

    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    await pollTranscribingMeetingIntelligenceJobs();
    expect(createTranscript).not.toHaveBeenCalled();
  });

  it("stops at TRANSCRIBED (preserving the transcript) rather than generating minutes when enrollment was disabled mid-flight", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({
      status: "completed",
      result: { language: "en", durationMs: 600_000, fullText: "hello", segments: [], speakerCount: 0 },
    });
    findUniqueTranscript.mockResolvedValueOnce(null);
    getOrganizationLabAccess.mockResolvedValueOnce({ available: false });

    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    const result = await pollTranscribingMeetingIntelligenceJobs();

    expect(createTranscript).toHaveBeenCalledTimes(1); // transcript preserved
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "TRANSCRIBED" }));
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED", failureCode: "MEETING_INTELLIGENCE_ENROLLMENT_DISABLED" }));
    expect(generateMeetingMinutes).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it("E2E-1 finding: stops at TRANSCRIBED (preserving the transcript, never calling the billable minutes generator) when the organization's billing is inactive, even if Labs enrollment is still active", async () => {
    findManyJob.mockResolvedValueOnce([transcribingJob()]);
    getStatus.mockResolvedValueOnce({
      status: "completed",
      result: { language: "en", durationMs: 600_000, fullText: "hello", segments: [], speakerCount: 0 },
    });
    findUniqueTranscript.mockResolvedValueOnce(null);
    resolveOrganizationAccess.mockResolvedValueOnce({ allowed: false, reason: "SUBSCRIPTION_PAST_DUE", trialEndsAt: null, subscriptionStatus: "past_due", billingExempt: false });

    const { pollTranscribingMeetingIntelligenceJobs } = await import("../worker");
    const result = await pollTranscribingMeetingIntelligenceJobs();

    expect(createTranscript).toHaveBeenCalledTimes(1); // transcript preserved
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "TRANSCRIBED" }));
    expect(transitionJob).toHaveBeenCalledWith(expect.objectContaining({ to: "FAILED", failureCode: "ORGANIZATION_SUBSCRIPTION_REQUIRED" }));
    expect(generateMeetingMinutes).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });
});
