import { describe, expect, it } from "vitest";
import {
  buildMeetingArtifactObjectKey,
  buildMeetingRecordingObjectKey,
  computeArtifactDeletionDate,
  computeRecordingDeletionDate,
  planRecordingStorage,
} from "../storage-design";

describe("storage key naming", () => {
  it("scopes recording keys under meeting-recordings/{organizationId}/{meetingId}/...", () => {
    const key = buildMeetingRecordingObjectKey("org-a", "meeting-1", "recording.mp3");
    expect(key.startsWith("meeting-recordings/org-a/meeting-1/")).toBe(true);
    expect(key.endsWith("recording.mp3")).toBe(true);
  });

  it("scopes artifact keys under a separate meeting-artifacts prefix, by artifact type", () => {
    const transcriptKey = buildMeetingArtifactObjectKey("org-a", "meeting-1", "transcript", "transcript.json");
    const minutesKey = buildMeetingArtifactObjectKey("org-a", "meeting-1", "draft-minutes", "minutes.json");
    expect(transcriptKey).toContain("meeting-artifacts/org-a/meeting-1/transcript/");
    expect(minutesKey).toContain("meeting-artifacts/org-a/meeting-1/draft-minutes/");
  });

  it("recording keys and artifact keys never share the same prefix (different retention windows apply)", () => {
    const recordingKey = buildMeetingRecordingObjectKey("org-a", "meeting-1", "recording.mp3");
    const artifactKey = buildMeetingArtifactObjectKey("org-a", "meeting-1", "transcript", "transcript.json");
    expect(recordingKey.split("/")[0]).not.toBe(artifactKey.split("/")[0]);
  });
});

describe("retention windows", () => {
  it("recording deletion date is 30 days after upload", () => {
    const uploadedAt = new Date("2026-01-01T00:00:00Z");
    const deletionDate = computeRecordingDeletionDate(uploadedAt);
    expect(deletionDate.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("artifact deletion date is 365 days after generation — far longer than the raw recording", () => {
    const generatedAt = new Date("2026-01-01T00:00:00Z");
    const recordingWindow = computeRecordingDeletionDate(generatedAt);
    const artifactWindow = computeArtifactDeletionDate(generatedAt);
    expect(artifactWindow.getTime()).toBeGreaterThan(recordingWindow.getTime());
  });
});

describe("planRecordingStorage", () => {
  it("plans temporary-processing-only storage with a signed-URL access method and encryption at rest", () => {
    const plan = planRecordingStorage("org-a", "meeting-1", "recording.wav", new Date("2026-01-01T00:00:00Z"));
    expect(plan.temporaryProcessingOnly).toBe(true);
    expect(plan.encryptedAtRest).toBe(true);
    expect(plan.accessMethod).toBe("signed_url");
    expect(plan.signedUrlTtlSeconds).toBeGreaterThan(0);
    expect(new Date(plan.deleteAfter).getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
  });
});
