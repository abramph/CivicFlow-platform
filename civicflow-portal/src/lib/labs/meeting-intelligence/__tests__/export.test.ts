import { describe, expect, it } from "vitest";
import { exportMeetingMinutes, minutesExportContentType, minutesExportFileName } from "../export";
import type { MinutesExportInput } from "../export/types";
import { AI_GENERATED_DISCLAIMER } from "../minutes";

function baseInput(overrides: Partial<MinutesExportInput> = {}): MinutesExportInput {
  return {
    organizationName: "APH Technologies, LLC",
    meetingTitle: "Monthly Board Meeting",
    meetingDate: "2026-01-01T18:00:00Z",
    isApproved: false,
    content: {
      meetingTitle: "Monthly Board Meeting",
      meetingDate: "2026-01-01T18:00:00Z",
      locationOrFormat: null,
      attendance: [{ speakerLabel: "Speaker A", attendeeName: "Alex Chair" }],
      agendaItems: ["Call to order"],
      discussionSummaries: [],
      motions: [{ text: "Approve budget", proposedBy: null, secondedBy: null, voteResult: "passed", evidence: [] }],
      decisions: ["Budget approved"],
      actionItems: [{ description: "Send agenda", owner: "Alex Chair", dueDate: null, evidence: [] }],
      unresolvedIssues: [],
      nextMeetingDetails: null,
      adjournmentTime: null,
      executiveSummary: null,
      status: "draft",
      aiDisclaimer: AI_GENERATED_DISCLAIMER,
    },
    ...overrides,
  };
}

describe("exportMeetingMinutes", () => {
  it("produces a non-empty DOCX buffer", async () => {
    const buffer = await exportMeetingMinutes(baseInput(), "docx");
    expect(buffer.byteLength).toBeGreaterThan(0);
    // DOCX is a zip archive — starts with the local file header signature "PK".
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  it("produces a non-empty PDF buffer", async () => {
    const buffer = await exportMeetingMinutes(baseInput(), "pdf");
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("never includes raw transcript content — the export input has no transcript field to leak", async () => {
    const input = baseInput();
    expect(Object.keys(input)).not.toContain("transcript");
    expect(Object.keys(input)).not.toContain("segments");
  });
});

describe("minutesExportContentType", () => {
  it("maps formats to the correct MIME types", () => {
    expect(minutesExportContentType("docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(minutesExportContentType("pdf")).toBe("application/pdf");
  });
});

describe("minutesExportFileName", () => {
  it("slugifies the meeting title and appends the format", () => {
    const name = minutesExportFileName("Monthly Board Meeting!", "pdf");
    expect(name).toMatch(/^monthly-board-meeting-minutes-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("falls back to a generic name for an empty/unusable title", () => {
    const name = minutesExportFileName("???", "docx");
    expect(name).toMatch(/^meeting-minutes-minutes-\d{4}-\d{2}-\d{2}\.docx$/);
  });
});
