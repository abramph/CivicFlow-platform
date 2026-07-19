import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstTranscript = vi.fn();
const updateTranscript = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingTranscript: {
      findFirst: (...args: unknown[]) => findFirstTranscript(...args),
      update: (...args: unknown[]) => updateTranscript(...args),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

beforeEach(() => vi.clearAllMocks());

const baseRow = {
  id: "transcript-1",
  jobId: "job-1",
  provider: "assemblyai",
  language: "en",
  speakerCount: 2,
  durationSeconds: 1800,
  content: "Hello there. General discussion.",
  segmentsJson: [
    { speakerLabel: "Speaker A", startMs: 0, endMs: 1000, text: "Hello there.", confidence: 0.9 },
    { speakerLabel: "Speaker B", startMs: 1000, endMs: 2000, text: "General discussion.", confidence: 0.9 },
  ],
  speakerLabelMapJson: null,
};

describe("getMeetingIntelligenceTranscript", () => {
  it("scopes the lookup by organizationId and returns null for a cross-tenant jobId", async () => {
    findFirstTranscript.mockResolvedValueOnce(null);
    const { getMeetingIntelligenceTranscript } = await import("../transcript");
    const result = await getMeetingIntelligenceTranscript("org-b", "job-from-org-a");
    expect(result).toBeNull();
    expect(findFirstTranscript).toHaveBeenCalledWith({ where: { jobId: "job-from-org-a", organizationId: "org-b" } });
  });

  it("returns a normalized view with parsed segments", async () => {
    findFirstTranscript.mockResolvedValueOnce(baseRow);
    const { getMeetingIntelligenceTranscript } = await import("../transcript");
    const result = await getMeetingIntelligenceTranscript("org-a", "job-1");
    expect(result?.segments).toHaveLength(2);
    expect(result?.speakerLabelMap).toEqual({});
  });
});

describe("renameMeetingIntelligenceSpeakerLabels", () => {
  it("rejects an unknown speaker label", async () => {
    findFirstTranscript.mockResolvedValueOnce(baseRow);
    const { renameMeetingIntelligenceSpeakerLabels } = await import("../transcript");
    await expect(
      renameMeetingIntelligenceSpeakerLabels({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1", labelMap: { "Speaker Z": "Nobody" } })
    ).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_JOB_NOT_FOUND" });
    expect(updateTranscript).not.toHaveBeenCalled();
  });

  it("writes only the display mapping, never touching segmentsJson (original vendor evidence preserved)", async () => {
    findFirstTranscript.mockResolvedValueOnce(baseRow);
    updateTranscript.mockResolvedValueOnce({ ...baseRow, speakerLabelMapJson: { "Speaker A": "Alex Chair" } });

    const { renameMeetingIntelligenceSpeakerLabels } = await import("../transcript");
    await renameMeetingIntelligenceSpeakerLabels({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1", labelMap: { "Speaker A": "Alex Chair" } });

    const call = updateTranscript.mock.calls[0][0];
    expect(call.data).toEqual({ speakerLabelMapJson: { "Speaker A": "Alex Chair" } });
    expect(call.data.segmentsJson).toBeUndefined();
  });

  it("audits only the renamed label keys, never the renamed-to value or transcript content", async () => {
    findFirstTranscript.mockResolvedValueOnce(baseRow);
    updateTranscript.mockResolvedValueOnce({ ...baseRow, speakerLabelMapJson: { "Speaker A": "Alex Chair" } });
    const { renameMeetingIntelligenceSpeakerLabels } = await import("../transcript");
    await renameMeetingIntelligenceSpeakerLabels({ organizationId: "org-a", jobId: "job-1", actorUserId: "user-1", labelMap: { "Speaker A": "Alex Chair" } });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "meeting_intelligence.speaker_labels_changed", metadata: { renamedLabels: ["Speaker A"] } })
    );
  });
});
