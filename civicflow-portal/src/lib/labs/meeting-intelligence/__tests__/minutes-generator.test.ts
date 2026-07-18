import { describe, expect, it } from "vitest";
import { AI_MINUTES_DISCLAIMER, generateDraftMinutes } from "../minutes-generator";
import type { TranscriptResult } from "../providers/types";

function makeTranscript(fullText: string, overrides: Partial<TranscriptResult> = {}): TranscriptResult {
  return {
    provider: "assemblyai",
    language: "en",
    durationMs: 30 * 60_000,
    fullText,
    segments: [
      { speakerLabel: "Speaker A", startMs: 0, endMs: 5000, text: fullText, confidence: 0.9 },
    ],
    ...overrides,
  };
}

describe("generateDraftMinutes", () => {
  it("always returns status 'draft' — there is no code path to anything else", () => {
    const transcript = makeTranscript("The meeting is now open.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.status).toBe("draft");
  });

  it("attaches the AI disclaimer to every generated result", () => {
    const transcript = makeTranscript("The meeting is now open.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.aiDisclaimer).toBe(AI_MINUTES_DISCLAIMER);
  });

  it("extracts a motion and a passed vote from matching transcript language", () => {
    const transcript = makeTranscript("I move to approve the budget. Second. All in favor say aye. The motion carries.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.motions.length).toBeGreaterThan(0);
    expect(minutes.votes[0].result).toBe("passed");
  });

  it("extracts action items from matching transcript language", () => {
    const transcript = makeTranscript("We need a volunteer to follow up with the vendor by Friday. I'll take that action item.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.actionItems.length).toBeGreaterThan(0);
  });

  it("extracts unresolved issues when the transcript defers a topic", () => {
    const transcript = makeTranscript("I'd like to propose we table this discussion until next month.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.unresolvedIssues.length).toBeGreaterThan(0);
  });

  it("detects adjournment language", () => {
    const transcript = makeTranscript("Meeting adjourned at the top of the hour.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.adjournment.mentioned).toBe(true);
  });

  it("does not falsely detect adjournment when it wasn't mentioned", () => {
    const transcript = makeTranscript("Let's discuss the budget.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.adjournment.mentioned).toBe(false);
  });

  it("populates attendance from distinct transcript speaker labels when no explicit attendee list is given", () => {
    const transcript = makeTranscript("Hello.", {
      segments: [
        { speakerLabel: "Speaker A", startMs: 0, endMs: 1000, text: "Hello.", confidence: 0.9 },
        { speakerLabel: "Speaker B", startMs: 1000, endMs: 2000, text: "Hi.", confidence: 0.9 },
      ],
    });
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    expect(minutes.attendance.map((a) => a.speakerLabel).sort()).toEqual(["Speaker A", "Speaker B"]);
  });

  it("uses the explicit attendee list when provided instead of raw speaker labels", () => {
    const transcript = makeTranscript("Hello.");
    const minutes = generateDraftMinutes(transcript, {
      meetingTitle: "Board Meeting",
      attendees: [{ speakerLabel: "Speaker A", attendeeName: "Alex Chair" }],
    });
    expect(minutes.attendance).toEqual([{ speakerLabel: "Speaker A", attendeeName: "Alex Chair" }]);
  });

  it("passes through the agenda unchanged", () => {
    const transcript = makeTranscript("Hello.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting", agenda: ["Call to order", "Old business"] });
    expect(minutes.agenda).toEqual(["Call to order", "Old business"]);
  });

  it("produces a fully JSON-serializable structured result (no functions, no undefined-valued fields breaking round-trip)", () => {
    const transcript = makeTranscript("I move to approve the budget. The motion carries. Meeting adjourned.");
    const minutes = generateDraftMinutes(transcript, { meetingTitle: "Board Meeting" });
    const roundTripped = JSON.parse(JSON.stringify(minutes));
    expect(roundTripped.meetingTitle).toBe("Board Meeting");
    expect(roundTripped.status).toBe("draft");
  });
});
