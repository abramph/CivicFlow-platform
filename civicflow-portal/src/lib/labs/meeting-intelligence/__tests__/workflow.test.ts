import { describe, expect, it } from "vitest";
import {
  FAILURE_HANDLING,
  canTransition,
  isTerminalStage,
  validateJobHistory,
  type MeetingJobStage,
} from "../workflow";

describe("Meeting Intelligence workflow state machine", () => {
  it("allows every stage of the documented happy path in sequence", () => {
    const happyPath: MeetingJobStage[] = [
      "CREATED",
      "RECORDING",
      "UPLOADING",
      "STORED",
      "QUEUED",
      "TRANSCRIBING",
      "DIARIZING",
      "AI_PROCESSING",
      "DRAFT_READY",
      "IN_REVIEW",
      "APPROVED",
      "ARCHIVED",
    ];
    for (let i = 1; i < happyPath.length; i += 1) {
      expect(canTransition(happyPath[i - 1], happyPath[i])).toBe(true);
    }
  });

  it("allows uploading a pre-recorded file directly from CREATED (skipping live RECORDING)", () => {
    expect(canTransition("CREATED", "UPLOADING")).toBe(true);
  });

  it("rejects an impossible jump from CREATED straight to APPROVED", () => {
    expect(canTransition("CREATED", "APPROVED")).toBe(false);
  });

  it("allows a secretary to send a draft back for regeneration from IN_REVIEW", () => {
    expect(canTransition("IN_REVIEW", "DRAFT_READY")).toBe(true);
  });

  it("allows retrying from FAILED back to QUEUED", () => {
    expect(canTransition("FAILED", "QUEUED")).toBe(true);
  });

  it("rejects any transition out of ARCHIVED or CANCELLED — both are true dead ends", () => {
    expect(canTransition("ARCHIVED", "QUEUED")).toBe(false);
    expect(canTransition("CANCELLED", "QUEUED")).toBe(false);
  });

  it("isTerminalStage is true only for ARCHIVED and CANCELLED — FAILED is not terminal since it's retryable", () => {
    expect(isTerminalStage("ARCHIVED")).toBe(true);
    expect(isTerminalStage("CANCELLED")).toBe(true);
    expect(isTerminalStage("FAILED")).toBe(false);
    expect(isTerminalStage("QUEUED")).toBe(false);
  });

  it("every stage with a defined failure-handling entry is retryable and carries an organization-facing message", () => {
    for (const handling of Object.values(FAILURE_HANDLING)) {
      expect(typeof handling.retryable).toBe("boolean");
      expect(handling.organizationFacingMessage.length).toBeGreaterThan(0);
    }
  });

  it("TRANSCRIBING and QUEUED failures notify a platform operator; RECORDING/UPLOADING failures (routine, self-service) do not", () => {
    expect(FAILURE_HANDLING.TRANSCRIBING.operatorNotified).toBe(true);
    expect(FAILURE_HANDLING.QUEUED.operatorNotified).toBe(true);
    expect(FAILURE_HANDLING.RECORDING.operatorNotified).toBe(false);
    expect(FAILURE_HANDLING.UPLOADING.operatorNotified).toBe(false);
  });
});

describe("validateJobHistory", () => {
  it("accepts a valid full happy-path history", () => {
    const result = validateJobHistory(
      ["CREATED", "UPLOADING", "STORED", "QUEUED", "TRANSCRIBING", "DIARIZING", "AI_PROCESSING", "DRAFT_READY", "IN_REVIEW", "APPROVED", "ARCHIVED"].map(
        (stage) => ({ stage: stage as MeetingJobStage, occurredAt: new Date().toISOString() })
      )
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an empty history", () => {
    expect(validateJobHistory([]).valid).toBe(false);
  });

  it("rejects a history that doesn't start at CREATED", () => {
    const result = validateJobHistory([{ stage: "QUEUED", occurredAt: new Date().toISOString() }]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/must start at CREATED/);
  });

  it("rejects a history with an invalid transition in the middle", () => {
    const result = validateJobHistory([
      { stage: "CREATED", occurredAt: new Date().toISOString() },
      { stage: "ARCHIVED", occurredAt: new Date().toISOString() },
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid transition/);
  });
});
