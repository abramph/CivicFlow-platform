import { describe, expect, it } from "vitest";
import { runMeetingIntelligenceSpikePipeline } from "../pipeline";

describe("runMeetingIntelligenceSpikePipeline", () => {
  it("produces a draft-status result with a transcript, speaker mapping, and cost estimate, using zero external API calls", async () => {
    const result = await runMeetingIntelligenceSpikePipeline({
      organizationId: "aph-org",
      meetingId: "meeting-1",
      meetingTitle: "Monthly Board Meeting",
      audioUrl: "synthetic://meeting-1",
      attendees: [
        { id: "att-1", name: "Alex Chair" },
        { id: "att-2", name: "Bailey Secretary" },
      ],
      agenda: ["Call to order", "Treasurer's report"],
    });

    expect(result.draftMinutes.status).toBe("draft");
    expect(result.transcript.segments.length).toBeGreaterThan(0);
    expect(result.costCents.totalCents).toBeGreaterThan(0);
    expect(result.speakerMapping.length).toBeGreaterThan(0);
    expect(result.draftMinutes.agenda).toEqual(["Call to order", "Treasurer's report"]);
  });

  it("defaults to resolveDefaultProviderId() (assemblyai) when no provider is specified", async () => {
    const result = await runMeetingIntelligenceSpikePipeline({
      organizationId: "aph-org",
      meetingId: "meeting-2",
      meetingTitle: "Committee Meeting",
      audioUrl: "synthetic://meeting-2",
    });
    expect(result.providerId).toBe("assemblyai");
    expect(result.transcript.provider).toBe("assemblyai");
  });

  it("respects an explicit provider override", async () => {
    const result = await runMeetingIntelligenceSpikePipeline({
      organizationId: "aph-org",
      meetingId: "meeting-3",
      meetingTitle: "Committee Meeting",
      audioUrl: "synthetic://meeting-3",
      providerId: "openai",
    });
    expect(result.providerId).toBe("openai");
    expect(result.transcript.provider).toBe("openai");
  });

  it("maps speakers to attendees positionally when an attendee list is supplied", async () => {
    const result = await runMeetingIntelligenceSpikePipeline({
      organizationId: "aph-org",
      meetingId: "meeting-4",
      meetingTitle: "Committee Meeting",
      audioUrl: "synthetic://meeting-4",
      attendees: [{ id: "att-1", name: "Alex Chair" }],
    });
    expect(result.speakerMapping[0].method).toBe("attendee_list_order");
  });

  it("falls back to unassigned speaker mapping when no attendee list is supplied", async () => {
    const result = await runMeetingIntelligenceSpikePipeline({
      organizationId: "aph-org",
      meetingId: "meeting-5",
      meetingTitle: "Committee Meeting",
      audioUrl: "synthetic://meeting-5",
    });
    expect(result.speakerMapping.every((mapping) => mapping.method === "unassigned")).toBe(true);
  });

  it("produces a fully JSON-serializable result end to end", async () => {
    const result = await runMeetingIntelligenceSpikePipeline({
      organizationId: "aph-org",
      meetingId: "meeting-6",
      meetingTitle: "Committee Meeting",
      audioUrl: "synthetic://meeting-6",
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
