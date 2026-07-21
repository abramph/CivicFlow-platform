import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstJob = vi.fn();
const upsertFeedback = vi.fn();
const findManyFeedback = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingIntelligenceJob: { findFirst: (...args: unknown[]) => findFirstJob(...args) },
    meetingIntelligenceFeedback: {
      upsert: (...args: unknown[]) => upsertFeedback(...args),
      findMany: (...args: unknown[]) => findManyFeedback(...args),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  createAuditEvent.mockResolvedValue(undefined);
});

const BASE_INPUT = {
  organizationId: "org-a",
  jobId: "job-1",
  actorUserId: "user-1",
  overallRating: 4,
};

describe("submitMeetingIntelligenceFeedback — validation", () => {
  it("rejects an overallRating outside 1-5", async () => {
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await expect(submitMeetingIntelligenceFeedback({ ...BASE_INPUT, overallRating: 0 })).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FEEDBACK_INVALID" });
    await expect(submitMeetingIntelligenceFeedback({ ...BASE_INPUT, overallRating: 6 })).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FEEDBACK_INVALID" });
    expect(findFirstJob).not.toHaveBeenCalled();
  });

  it("rejects a non-integer sub-rating", async () => {
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await expect(submitMeetingIntelligenceFeedback({ ...BASE_INPUT, transcriptionQualityRating: 3.5 })).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FEEDBACK_INVALID" });
  });

  it("rejects an unknown issueCategory", async () => {
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await expect(submitMeetingIntelligenceFeedback({ ...BASE_INPUT, issueCategory: "not_a_real_category" })).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FEEDBACK_INVALID" });
  });

  it("rejects a negative timeSavedMinutes", async () => {
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await expect(submitMeetingIntelligenceFeedback({ ...BASE_INPUT, timeSavedMinutes: -5 })).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FEEDBACK_INVALID" });
  });
});

describe("submitMeetingIntelligenceFeedback — job resolution and eligibility", () => {
  it("cannot submit feedback for another organization's job (tenant isolation)", async () => {
    findFirstJob.mockResolvedValueOnce(null); // simulates real Prisma behavior for a non-matching where clause
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await expect(submitMeetingIntelligenceFeedback({ ...BASE_INPUT, organizationId: "org-b" })).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND" });
    expect(findFirstJob).toHaveBeenCalledWith({ where: { id: "job-1", organizationId: "org-b" } });
  });

  it("rejects feedback for a job that hasn't reached an eligible stage yet", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", status: "TRANSCRIBING" });
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await expect(submitMeetingIntelligenceFeedback(BASE_INPUT)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FEEDBACK_NOT_ELIGIBLE" });
    expect(upsertFeedback).not.toHaveBeenCalled();
  });

  it.each(["DRAFT_READY", "IN_REVIEW", "APPROVED", "FAILED"])("accepts feedback once the job has reached %s", async (status) => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", status });
    upsertFeedback.mockResolvedValueOnce({ id: "feedback-1" });
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await expect(submitMeetingIntelligenceFeedback(BASE_INPUT)).resolves.toMatchObject({ id: "feedback-1" });
  });
});

describe("submitMeetingIntelligenceFeedback — idempotent upsert (no duplicate rows on a race)", () => {
  it("upserts on the (jobId, submittedByUserId) unique key rather than a check-then-create", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", status: "APPROVED" });
    upsertFeedback.mockResolvedValueOnce({ id: "feedback-1" });
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await submitMeetingIntelligenceFeedback(BASE_INPUT);

    expect(upsertFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId_submittedByUserId: { jobId: "job-1", submittedByUserId: "user-1" } },
        create: expect.objectContaining({ organizationId: "org-a", jobId: "job-1", submittedByUserId: "user-1", overallRating: 4 }),
        update: expect.objectContaining({ overallRating: 4 }),
      })
    );
    // A second submission from the same user for the same job resolves to
    // the same atomic upsert call — the database's unique constraint (not
    // application-level check-then-act) is what prevents a duplicate row
    // if two submissions race, so no separate "already exists" branch is
    // needed here.
  });

  it("caps free-text comments defensively", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", status: "APPROVED" });
    upsertFeedback.mockResolvedValueOnce({ id: "feedback-1" });
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await submitMeetingIntelligenceFeedback({ ...BASE_INPUT, comments: "x".repeat(5000) });
    const call = upsertFeedback.mock.calls[0][0];
    expect(call.create.comments.length).toBe(4000);
  });

  it("audits the submission without ever including the free-text comment", async () => {
    findFirstJob.mockResolvedValueOnce({ id: "job-1", status: "APPROVED" });
    upsertFeedback.mockResolvedValueOnce({ id: "feedback-1" });
    const { submitMeetingIntelligenceFeedback } = await import("../feedback");
    await submitMeetingIntelligenceFeedback({ ...BASE_INPUT, comments: "sensitive-sounding text" });

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "meeting_intelligence.feedback_submitted",
        organizationId: "org-a",
        actorUserId: "user-1",
      })
    );
    const auditCall = createAuditEvent.mock.calls[0][0];
    expect(JSON.stringify(auditCall.metadata)).not.toContain("sensitive-sounding text");
  });
});

describe("listMeetingIntelligenceFeedbackForJob", () => {
  it("scopes strictly by organizationId — org-b can never list org-a's feedback", async () => {
    findManyFeedback.mockResolvedValueOnce([]);
    const { listMeetingIntelligenceFeedbackForJob } = await import("../feedback");
    const result = await listMeetingIntelligenceFeedbackForJob("org-b", "job-belonging-to-org-a");
    expect(result).toEqual([]);
    expect(findManyFeedback).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-b", jobId: "job-belonging-to-org-a" } }));
  });
});
