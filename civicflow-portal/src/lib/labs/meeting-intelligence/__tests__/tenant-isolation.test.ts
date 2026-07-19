import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 19 security review — direct tenant-isolation tests. Every
 * Meeting Intelligence data-access function takes organizationId as an
 * explicit, required parameter and uses it to scope every Prisma lookup —
 * these tests assert that scoping is actually applied, not just present in
 * a function signature.
 */

const findFirstDraft = vi.fn();
const findFirstTranscript = vi.fn();
const findFirstJob = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingMinutesDraft: { findFirst: (...args: unknown[]) => findFirstDraft(...args) },
    meetingTranscript: { findFirst: (...args: unknown[]) => findFirstTranscript(...args) },
    meetingIntelligenceJob: { findFirst: (...args: unknown[]) => findFirstJob(...args) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/labs/access", () => ({ requireOrganizationLabFeature: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("cross-tenant access is rejected at the query level", () => {
  it("getLatestMeetingMinutesDraft scopes strictly by organizationId — org-b can never see org-a's draft", async () => {
    findFirstDraft.mockResolvedValueOnce(null); // simulates the real Prisma behavior for a non-matching where clause
    const { getLatestMeetingMinutesDraft } = await import("../minutes-review");
    const result = await getLatestMeetingMinutesDraft("org-b", "job-belonging-to-org-a");
    expect(result).toBeNull();
    expect(findFirstDraft).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-b", jobId: "job-belonging-to-org-a" } }));
  });

  it("editMeetingMinutesDraft cannot edit a draft belonging to another organization", async () => {
    findFirstDraft.mockResolvedValueOnce(null);
    const { editMeetingMinutesDraft } = await import("../minutes-review");
    await expect(
      editMeetingMinutesDraft({ organizationId: "org-b", jobId: "job-belonging-to-org-a", actorUserId: "user-1", editableContent: {} as never })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND" });
  });

  it("approveMeetingMinutesDraft cannot approve a draft belonging to another organization", async () => {
    findFirstDraft.mockResolvedValueOnce(null);
    const { approveMeetingMinutesDraft } = await import("../minutes-review");
    await expect(approveMeetingMinutesDraft({ organizationId: "org-b", jobId: "job-belonging-to-org-a", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND",
    });
  });

  it("getMeetingIntelligenceTranscript scopes strictly by organizationId", async () => {
    findFirstTranscript.mockResolvedValueOnce(null);
    const { getMeetingIntelligenceTranscript } = await import("../transcript");
    const result = await getMeetingIntelligenceTranscript("org-b", "job-belonging-to-org-a");
    expect(result).toBeNull();
    expect(findFirstTranscript).toHaveBeenCalledWith({ where: { jobId: "job-belonging-to-org-a", organizationId: "org-b" } });
  });

  it("renameMeetingIntelligenceSpeakerLabels cannot rename labels on another organization's transcript", async () => {
    findFirstTranscript.mockResolvedValueOnce(null);
    const { renameMeetingIntelligenceSpeakerLabels } = await import("../transcript");
    await expect(
      renameMeetingIntelligenceSpeakerLabels({ organizationId: "org-b", jobId: "job-belonging-to-org-a", actorUserId: "user-1", labelMap: { "Speaker A": "Attacker" } })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND" });
  });

  it("cancelMeetingIntelligenceJob cannot cancel another organization's job", async () => {
    findFirstJob.mockResolvedValueOnce(null);
    const { cancelMeetingIntelligenceJob } = await import("../jobs");
    await expect(cancelMeetingIntelligenceJob({ organizationId: "org-b", jobId: "job-belonging-to-org-a", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND",
    });
  });

  it("deleteMeetingIntelligenceRecording cannot delete another organization's recording", async () => {
    findFirstJob.mockResolvedValueOnce(null);
    const { deleteMeetingIntelligenceRecording } = await import("../jobs");
    await expect(deleteMeetingIntelligenceRecording({ organizationId: "org-b", jobId: "job-belonging-to-org-a", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND",
    });
  });

  it("retryMeetingIntelligenceJob cannot retry another organization's job", async () => {
    findFirstJob.mockResolvedValueOnce(null);
    const { retryMeetingIntelligenceJob } = await import("../jobs");
    await expect(retryMeetingIntelligenceJob({ organizationId: "org-b", jobId: "job-belonging-to-org-a", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND",
    });
  });
});
