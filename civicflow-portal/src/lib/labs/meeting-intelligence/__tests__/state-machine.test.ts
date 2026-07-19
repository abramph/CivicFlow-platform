import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstJob = vi.fn();
const updateJob = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingIntelligenceJob: {
      findFirst: (...args: unknown[]) => findFirstJob(...args),
      update: (...args: unknown[]) => updateJob(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    organizationId: "org-a",
    status: "CREATED",
    ...overrides,
  };
}

describe("canTransition / isTerminalStage", () => {
  it("allows the full happy path in sequence", async () => {
    const { canTransition } = await import("../state-machine");
    const path = [
      "CREATED",
      "UPLOAD_PENDING",
      "UPLOADED",
      "QUEUED",
      "SUBMITTED_TO_PROVIDER",
      "TRANSCRIBING",
      "TRANSCRIBED",
      "GENERATING_MINUTES",
      "DRAFT_READY",
      "IN_REVIEW",
      "APPROVED",
    ] as const;
    for (let i = 1; i < path.length; i += 1) {
      expect(canTransition(path[i - 1], path[i])).toBe(true);
    }
  });

  it("rejects an impossible jump from CREATED to APPROVED", async () => {
    const { canTransition } = await import("../state-machine");
    expect(canTransition("CREATED", "APPROVED")).toBe(false);
  });

  it("allows IN_REVIEW to send a draft back to DRAFT_READY for regeneration", async () => {
    const { canTransition } = await import("../state-machine");
    expect(canTransition("IN_REVIEW", "DRAFT_READY")).toBe(true);
  });

  it("allows retrying from FAILED back to QUEUED", async () => {
    const { canTransition } = await import("../state-machine");
    expect(canTransition("FAILED", "QUEUED")).toBe(true);
  });

  it("allows DELETED from almost every non-CREATED stage", async () => {
    const { canTransition } = await import("../state-machine");
    for (const stage of ["UPLOADED", "QUEUED", "SUBMITTED_TO_PROVIDER", "TRANSCRIBING", "TRANSCRIBED", "GENERATING_MINUTES", "DRAFT_READY", "IN_REVIEW", "APPROVED", "FAILED", "CANCELLED"] as const) {
      expect(canTransition(stage, "DELETED")).toBe(true);
    }
  });

  it("DELETED is the only true dead end", async () => {
    const { canTransition, isTerminalStage } = await import("../state-machine");
    expect(isTerminalStage("DELETED")).toBe(true);
    expect(canTransition("DELETED", "QUEUED")).toBe(false);
    expect(isTerminalStage("FAILED")).toBe(false);
    expect(isTerminalStage("APPROVED")).toBe(false);
  });
});

describe("transitionJob", () => {
  it("scopes the job lookup by organizationId and throws JobNotFoundError when it doesn't match", async () => {
    findFirstJob.mockResolvedValueOnce(null);
    const { transitionJob, JobNotFoundError } = await import("../state-machine");
    await expect(transitionJob({ jobId: "job-1", organizationId: "org-b", to: "UPLOAD_PENDING" })).rejects.toBeInstanceOf(JobNotFoundError);
    expect(findFirstJob).toHaveBeenCalledWith({ where: { id: "job-1", organizationId: "org-b" } });
  });

  it("throws InvalidTransitionError for a disallowed transition and never writes", async () => {
    findFirstJob.mockResolvedValueOnce(makeJob({ status: "CREATED" }));
    const { transitionJob, InvalidTransitionError } = await import("../state-machine");
    await expect(transitionJob({ jobId: "job-1", organizationId: "org-a", to: "APPROVED" })).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(updateJob).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("is idempotent: transitioning to the job's current state is a no-op, no write, no audit event", async () => {
    findFirstJob.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    const { transitionJob } = await import("../state-machine");
    const result = await transitionJob({ jobId: "job-1", organizationId: "org-a", to: "QUEUED" });
    expect(result.status).toBe("QUEUED");
    expect(updateJob).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("writes the correct timestamp field for the target stage", async () => {
    findFirstJob.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    updateJob.mockResolvedValueOnce(makeJob({ status: "SUBMITTED_TO_PROVIDER" }));
    const { transitionJob } = await import("../state-machine");
    await transitionJob({ jobId: "job-1", organizationId: "org-a", to: "SUBMITTED_TO_PROVIDER" });
    const call = updateJob.mock.calls[0][0];
    expect(call.data.status).toBe("SUBMITTED_TO_PROVIDER");
    expect(call.data.submittedAt).toBeInstanceOf(Date);
  });

  it("writes failureCode/failureMessage when transitioning to FAILED", async () => {
    findFirstJob.mockResolvedValueOnce(makeJob({ status: "TRANSCRIBING" }));
    updateJob.mockResolvedValueOnce(makeJob({ status: "FAILED" }));
    const { transitionJob } = await import("../state-machine");
    await transitionJob({
      jobId: "job-1",
      organizationId: "org-a",
      to: "FAILED",
      failureCode: "MEETING_INTELLIGENCE_TRANSCRIPTION_FAILED",
      failureMessage: "Provider returned an error",
    });
    const call = updateJob.mock.calls[0][0];
    expect(call.data.failureCode).toBe("MEETING_INTELLIGENCE_TRANSCRIPTION_FAILED");
    expect(call.data.failedAt).toBeInstanceOf(Date);
  });

  it("merges extraData into the same update call rather than a second write", async () => {
    findFirstJob.mockResolvedValueOnce(makeJob({ status: "UPLOADED" }));
    updateJob.mockResolvedValueOnce(makeJob({ status: "QUEUED" }));
    const { transitionJob } = await import("../state-machine");
    await transitionJob({ jobId: "job-1", organizationId: "org-a", to: "QUEUED", extraData: { audioDurationSeconds: 1800 } });
    expect(updateJob).toHaveBeenCalledTimes(1);
    expect(updateJob.mock.calls[0][0].data.audioDurationSeconds).toBe(1800);
  });

  it("writes an audit event recording the previous and new status", async () => {
    findFirstJob.mockResolvedValueOnce(makeJob({ status: "CREATED" }));
    updateJob.mockResolvedValueOnce(makeJob({ status: "UPLOAD_PENDING" }));
    const { transitionJob } = await import("../state-machine");
    await transitionJob({ jobId: "job-1", organizationId: "org-a", to: "UPLOAD_PENDING", actorUserId: "user-1", actorEmail: "a@example.com" });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        actorUserId: "user-1",
        action: "meeting_intelligence.job.upload_pending",
        entityType: "meeting_intelligence_job",
        entityId: "job-1",
        metadata: expect.objectContaining({ previousStatus: "CREATED", newStatus: "UPLOAD_PENDING" }),
      })
    );
  });

  it("never includes transcript or draft content in the audit event metadata (only status strings)", async () => {
    findFirstJob.mockResolvedValueOnce(makeJob({ status: "TRANSCRIBED" }));
    updateJob.mockResolvedValueOnce(makeJob({ status: "GENERATING_MINUTES" }));
    const { transitionJob } = await import("../state-machine");
    await transitionJob({ jobId: "job-1", organizationId: "org-a", to: "GENERATING_MINUTES" });
    const metadata = createAuditEvent.mock.calls[0][0].metadata;
    expect(Object.keys(metadata).sort()).toEqual(["newStatus", "previousStatus"]);
  });
});
