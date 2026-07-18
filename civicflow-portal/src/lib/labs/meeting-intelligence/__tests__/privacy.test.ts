import { describe, expect, it } from "vitest";
import { PRIVACY_CHECKLIST, validateMeetingIntelligenceSubmission } from "../privacy";

describe("validateMeetingIntelligenceSubmission", () => {
  const fullyValid = {
    explicitUserTriggered: true,
    recordingNoticeAcknowledged: true,
    organizationOwnershipConfirmed: true,
  };

  it("allows a submission where every condition is explicitly true", () => {
    expect(validateMeetingIntelligenceSubmission(fullyValid)).toEqual({ allowed: true });
  });

  it("denies when recording/upload was not explicitly user-triggered", () => {
    const result = validateMeetingIntelligenceSubmission({ ...fullyValid, explicitUserTriggered: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/explicitly triggered/);
  });

  it("denies when the recording notice was not acknowledged", () => {
    const result = validateMeetingIntelligenceSubmission({ ...fullyValid, recordingNoticeAcknowledged: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/notified of recording/);
  });

  it("denies when organization ownership was not confirmed", () => {
    const result = validateMeetingIntelligenceSubmission({ ...fullyValid, organizationOwnershipConfirmed: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/ownership/);
  });

  it("fails closed — every field defaults to denying, none default to true", () => {
    const result = validateMeetingIntelligenceSubmission({
      explicitUserTriggered: false,
      recordingNoticeAcknowledged: false,
      organizationOwnershipConfirmed: false,
    });
    expect(result.allowed).toBe(false);
  });
});

describe("PRIVACY_CHECKLIST", () => {
  it("covers every required Phase 8 topic", () => {
    const topics = PRIVACY_CHECKLIST.map((item) => item.topic);
    for (const required of [
      "Consent",
      "Recording notices",
      "Retention",
      "Deletion",
      "Encryption",
      "Audit trail",
      "Access logging",
      "Transcript editing",
      "Human approval",
      "AI disclaimer",
      "Organization ownership",
      "Data portability",
    ]) {
      expect(topics).toContain(required);
    }
  });

  it("every checklist item has a non-empty detail and a valid status", () => {
    for (const item of PRIVACY_CHECKLIST) {
      expect(item.detail.length).toBeGreaterThan(0);
      expect(["documented", "prototyped", "not_built"]).toContain(item.status);
    }
  });
});
