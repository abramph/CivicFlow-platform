import { beforeEach, describe, expect, it, vi } from "vitest";

const groupByJob = vi.fn();
const findManyJob = vi.fn();
const countJob = vi.fn();
const findUniqueJob = vi.fn();
const findManyLabFeature = vi.fn();
const findFirstAuditEvent = vi.fn();
const findManyAuditEvent = vi.fn();
const groupByLabUsage = vi.fn();
const aggregateFeedback = vi.fn();
const groupByFeedback = vi.fn();
const findManyFeedback = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingIntelligenceJob: {
      groupBy: (...a: unknown[]) => groupByJob(...a),
      findMany: (...a: unknown[]) => findManyJob(...a),
      count: (...a: unknown[]) => countJob(...a),
      findUnique: (...a: unknown[]) => findUniqueJob(...a),
    },
    organizationLabFeature: { findMany: (...a: unknown[]) => findManyLabFeature(...a) },
    auditEvent: {
      findFirst: (...a: unknown[]) => findFirstAuditEvent(...a),
      findMany: (...a: unknown[]) => findManyAuditEvent(...a),
    },
    labUsageEvent: { groupBy: (...a: unknown[]) => groupByLabUsage(...a) },
    meetingIntelligenceFeedback: {
      aggregate: (...a: unknown[]) => aggregateFeedback(...a),
      groupBy: (...a: unknown[]) => groupByFeedback(...a),
      findMany: (...a: unknown[]) => findManyFeedback(...a),
    },
  },
}));

// These lower-level modules pull in heavy transitive dependencies (AssemblyAI
// adapter, OpenAI generator, S3 client) that have nothing to do with this
// aggregation layer — mocked to just their stable, documented surface.
vi.mock("@/lib/labs/meeting-intelligence/worker", () => ({ CLAIM_STALE_AFTER_MS: 10 * 60_000 }));
vi.mock("@/lib/labs/meeting-intelligence/retention", () => ({ SETTLED_STAGES: ["DRAFT_READY", "IN_REVIEW", "APPROVED", "FAILED", "CANCELLED"] }));
vi.mock("@/lib/labs/meeting-intelligence/storage", () => ({ RECORDING_RETENTION_DAYS: 30 }));
vi.mock("@/lib/storage", () => ({ verifySpacesBucketAccess: vi.fn() }));

const resolveMeetingIntelligenceProviderId = vi.fn();
const getOpenAiApiKey = vi.fn();
vi.mock("@/lib/labs/meeting-intelligence/config", () => ({
  resolveMeetingIntelligenceProviderId: (...a: unknown[]) => resolveMeetingIntelligenceProviderId(...a),
  getOpenAiApiKey: (...a: unknown[]) => getOpenAiApiKey(...a),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  resolveMeetingIntelligenceProviderId.mockReturnValue("assemblyai");
  getOpenAiApiKey.mockReturnValue(undefined);
});

describe("getMeetingIntelligenceEnrollments", () => {
  it("returns every organization enrolled in meetingIntelligence, joined with org name/slug", async () => {
    findManyLabFeature.mockResolvedValueOnce([
      { organizationId: "org-a", status: "ENABLED", enabledAt: new Date("2026-07-19T00:00:00Z"), organization: { name: "APH Technologies, LLC", slug: "aph" } },
    ]);
    const { getMeetingIntelligenceEnrollments } = await import("../meeting-intelligence");
    const result = await getMeetingIntelligenceEnrollments();
    expect(result).toEqual([{ organizationId: "org-a", organizationName: "APH Technologies, LLC", organizationSlug: "aph", status: "ENABLED", enabledAt: "2026-07-19T00:00:00.000Z" }]);
    expect(findManyLabFeature).toHaveBeenCalledWith(expect.objectContaining({ where: { featureKey: "meetingIntelligence" } }));
  });
});

describe("getMeetingIntelligenceStaticDiagnostics", () => {
  it("reports AssemblyAI not_configured when ASSEMBLYAI_API_KEY is unset, without a live call", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    const { getMeetingIntelligenceStaticDiagnostics } = await import("../meeting-intelligence");
    const results = getMeetingIntelligenceStaticDiagnostics();
    const assemblyAi = results.find((r) => r.service.startsWith("AssemblyAI"));
    expect(assemblyAi?.status).toBe("not_configured");
  });

  it("reports AssemblyAI healthy (inferred) when configured and the provider resolves", async () => {
    process.env.ASSEMBLYAI_API_KEY = "test-key";
    const { getMeetingIntelligenceStaticDiagnostics } = await import("../meeting-intelligence");
    const results = getMeetingIntelligenceStaticDiagnostics();
    const assemblyAi = results.find((r) => r.service.startsWith("AssemblyAI"));
    expect(assemblyAi?.status).toBe("healthy");
    expect(assemblyAi?.freshness).toBe("inferred");
  });

  it("never includes the actual key value in any diagnostic message", async () => {
    process.env.ASSEMBLYAI_API_KEY = "super-secret-key-value";
    const { getMeetingIntelligenceStaticDiagnostics } = await import("../meeting-intelligence");
    const results = getMeetingIntelligenceStaticDiagnostics();
    for (const r of results) {
      expect(r.message).not.toContain("super-secret-key-value");
    }
  });

  it("treats a missing OpenAI key as informational, not a failure — the deterministic fallback is a valid state", async () => {
    getOpenAiApiKey.mockReturnValue(undefined);
    const { getMeetingIntelligenceStaticDiagnostics } = await import("../meeting-intelligence");
    const results = getMeetingIntelligenceStaticDiagnostics();
    const openAi = results.find((r) => r.service.startsWith("OpenAI"));
    expect(openAi?.status).toBe("not_configured");
    expect(openAi?.message).toContain("not an error");
  });

  it("reports degraded (not a thrown exception) when the provider id is misconfigured", async () => {
    process.env.ASSEMBLYAI_API_KEY = "test-key";
    resolveMeetingIntelligenceProviderId.mockImplementation(() => {
      const err = new Error("MEETING_INTELLIGENCE_PROVIDER is set to an unrecognized value.");
      (err as unknown as { code: string }).code = "MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED";
      throw err;
    });
    const { getMeetingIntelligenceStaticDiagnostics } = await import("../meeting-intelligence");
    expect(() => getMeetingIntelligenceStaticDiagnostics()).not.toThrow();
  });
});

describe("getMeetingIntelligenceJobStatusCounts", () => {
  it("sums per-status counts into a total", async () => {
    groupByJob.mockResolvedValueOnce([
      { status: "QUEUED", _count: { _all: 3 } },
      { status: "FAILED", _count: { _all: 2 } },
    ]);
    const { getMeetingIntelligenceJobStatusCounts } = await import("../meeting-intelligence");
    const result = await getMeetingIntelligenceJobStatusCounts();
    expect(result).toEqual({ counts: { QUEUED: 3, FAILED: 2 }, total: 5 });
  });
});

describe("getMeetingIntelligenceStuckJobs", () => {
  it("queries only QUEUED jobs with a stale claimedAt or TRANSCRIBING jobs with a stale pollClaimedAt", async () => {
    findManyJob.mockResolvedValueOnce([]);
    const { getMeetingIntelligenceStuckJobs } = await import("../meeting-intelligence");
    await getMeetingIntelligenceStuckJobs();
    const callArgs = findManyJob.mock.calls[0][0];
    expect(callArgs.where.OR).toEqual([
      { status: "QUEUED", claimedAt: { lt: expect.any(Date) } },
      { status: "TRANSCRIBING", pollClaimedAt: { lt: expect.any(Date) } },
    ]);
  });

  it("never includes transcript, draft content, or recording filenames in the returned shape", async () => {
    findManyJob.mockResolvedValueOnce([
      { id: "job-1", organizationId: "org-a", status: "QUEUED", claimedAt: new Date(), pollClaimedAt: null, createdAt: new Date(), organization: { name: "APH" } },
    ]);
    const { getMeetingIntelligenceStuckJobs } = await import("../meeting-intelligence");
    const result = await getMeetingIntelligenceStuckJobs();
    expect(Object.keys(result[0]).sort()).toEqual(["claimedAt", "createdAt", "id", "organizationId", "organizationName", "pollClaimedAt", "status"].sort());
  });
});

describe("getMeetingIntelligenceFailedJobs", () => {
  it("marks a job retryable only when its failureCode is in the retryable set", async () => {
    findManyJob.mockResolvedValueOnce([
      { id: "job-1", organizationId: "org-a", failureCode: "MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE", failureMessage: "x", createdAt: new Date(), failedAt: new Date(), organization: { name: "APH" } },
      { id: "job-2", organizationId: "org-a", failureCode: "MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED", failureMessage: "y", createdAt: new Date(), failedAt: new Date(), organization: { name: "APH" } },
    ]);
    const { getMeetingIntelligenceFailedJobs } = await import("../meeting-intelligence");
    const result = await getMeetingIntelligenceFailedJobs();
    expect(result.find((j) => j.id === "job-1")?.retryable).toBe(true);
    expect(result.find((j) => j.id === "job-2")?.retryable).toBe(false);
  });
});

describe("getMeetingIntelligenceRetentionStatus", () => {
  it("computes pending vs. due-for-deletion recording counts using the same retention window as the retention cron", async () => {
    findFirstAuditEvent.mockResolvedValueOnce({ createdAt: new Date("2026-07-20T00:00:00Z") });
    countJob.mockResolvedValueOnce(10); // pending
    countJob.mockResolvedValueOnce(2); // due
    const { getMeetingIntelligenceRetentionStatus } = await import("../meeting-intelligence");
    const result = await getMeetingIntelligenceRetentionStatus();
    expect(result).toEqual({
      lastRecordingDeletionAt: "2026-07-20T00:00:00.000Z",
      recordingsPendingDeletion: 10,
      recordingsDueForDeletion: 2,
    });
  });
});

describe("getMeetingIntelligenceUsageEstimate", () => {
  it("maps summed LabUsageEvent quantities by unit, defaulting missing units to 0", async () => {
    groupByLabUsage.mockResolvedValueOnce([
      { unit: "audio_minutes_uploaded", _sum: { quantity: 42.5 } },
      { unit: "transcription_provider_cost_estimate", _sum: { quantity: 19 } },
    ]);
    const { getMeetingIntelligenceUsageEstimate } = await import("../meeting-intelligence");
    const result = await getMeetingIntelligenceUsageEstimate();
    expect(result.audioMinutesUploaded).toBe(42.5);
    expect(result.estimatedTranscriptionCostCents).toBe(19);
    expect(result.audioMinutesTranscribed).toBe(0);
    expect(result.minutesGenerationJobs).toBe(0);
  });
});

describe("getMeetingIntelligenceFeedbackSummary", () => {
  it("never includes submittedByUserId or any field beyond rating/category/comments/timestamp", async () => {
    aggregateFeedback.mockResolvedValueOnce({ _avg: { overallRating: 4.5 }, _count: { _all: 2 } });
    groupByFeedback.mockResolvedValueOnce([{ issueCategory: "transcription", _count: { _all: 1 } }]);
    findManyFeedback.mockResolvedValueOnce([{ id: "fb-1", overallRating: 5, issueCategory: null, comments: null, createdAt: new Date() }]);
    const { getMeetingIntelligenceFeedbackSummary } = await import("../meeting-intelligence");
    const result = await getMeetingIntelligenceFeedbackSummary();
    expect(result.count).toBe(2);
    expect(result.averageOverallRating).toBe(4.5);
    expect(result.issueCategoryBreakdown).toEqual({ transcription: 1 });
    expect(Object.keys(result.recent[0]).sort()).toEqual(["comments", "createdAt", "id", "issueCategory", "overallRating"].sort());
  });
});

describe("getMeetingIntelligenceJobForAdmin", () => {
  it("looks up a job by id only (cross-tenant, admin-scoped) and selects a minimal, safe field set", async () => {
    findUniqueJob.mockResolvedValueOnce({ id: "job-1", organizationId: "org-a", status: "FAILED", failureCode: "X" });
    const { getMeetingIntelligenceJobForAdmin } = await import("../meeting-intelligence");
    await getMeetingIntelligenceJobForAdmin("job-1");
    expect(findUniqueJob).toHaveBeenCalledWith({
      where: { id: "job-1" },
      select: { id: true, organizationId: true, status: true, failureCode: true },
    });
  });
});
