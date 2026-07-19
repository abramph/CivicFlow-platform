import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deterministicMinutesGenerator } from "../minutes/deterministic-generator";
import { openAiMinutesGenerator } from "../minutes/openai-generator";
import { resolveMeetingMinutesGenerator } from "../minutes";
import type { TranscriptSegment } from "../providers/async-types";

function segment(overrides: Partial<TranscriptSegment>): TranscriptSegment {
  return { speakerLabel: "Speaker A", startMs: 0, endMs: 1000, text: "", confidence: 0.9, ...overrides };
}

describe("deterministicMinutesGenerator", () => {
  it("always returns status 'draft' with a disclaimer attached", async () => {
    const result = await deterministicMinutesGenerator.generate({
      meetingTitle: "Board Meeting",
      segments: [segment({ text: "The meeting is now open." })],
      fullText: "The meeting is now open.",
    });
    expect(result.status).toBe("draft");
    expect(result.aiDisclaimer).toMatch(/human review/i);
  });

  it("never claims to be AI-generated — it must not be mistaken for a genuine AI-produced summary", async () => {
    const result = await deterministicMinutesGenerator.generate({
      meetingTitle: "Board Meeting",
      segments: [segment({ text: "The meeting is now open." })],
      fullText: "The meeting is now open.",
    });
    expect(result.aiDisclaimer).not.toMatch(/AI-generated draft —/i);
    expect(result.aiDisclaimer).toMatch(/not AI-generated/i);
  });

  it("uses a disclaimer distinct from the OpenAI generator's — the two must never share text a reviewer could conflate", async () => {
    const { AI_GENERATED_DISCLAIMER } = await import("../minutes/types");
    const result = await deterministicMinutesGenerator.generate({
      meetingTitle: "Board Meeting",
      segments: [segment({ text: "The meeting is now open." })],
      fullText: "The meeting is now open.",
    });
    expect(result.aiDisclaimer).not.toBe(AI_GENERATED_DISCLAIMER);
  });

  it("extracts a motion with evidence pointing back to the source segment", async () => {
    const segments = [segment({ text: "I move to approve the budget." }), segment({ text: "The motion carries." })];
    const result = await deterministicMinutesGenerator.generate({
      meetingTitle: "Board Meeting",
      segments,
      fullText: segments.map((s) => s.text).join(" "),
    });
    expect(result.motions).toHaveLength(1);
    expect(result.motions[0].voteResult).toBe("passed");
    expect(result.motions[0].evidence[0]).toEqual({ segmentIndex: 0, startMs: 0, endMs: 1000 });
  });

  it("does not misattribute one motion's vote outcome to a different motion in the same transcript", async () => {
    const segments = [
      segment({ text: "I move to approve the budget." }),
      segment({ text: "The motion carries." }),
      segment({ text: "I move to table the rezoning request." }),
      segment({ text: "Motion failed, opposed by three members." }),
    ];
    const result = await deterministicMinutesGenerator.generate({
      meetingTitle: "Board Meeting",
      segments,
      fullText: segments.map((s) => s.text).join(" "),
    });
    expect(result.motions).toHaveLength(2);
    expect(result.motions[0].voteResult).toBe("passed");
    expect(result.motions[1].voteResult).toBe("failed");
  });

  it("leaves voteResult unrecorded rather than guessing when no outcome language follows the motion", async () => {
    const segments = [segment({ text: "I move to approve the budget." }), segment({ text: "Let's move to the next agenda item." })];
    const result = await deterministicMinutesGenerator.generate({
      meetingTitle: "Board Meeting",
      segments,
      fullText: segments.map((s) => s.text).join(" "),
    });
    expect(result.motions[0].voteResult).toBe("unrecorded");
  });

  it("never fabricates a proposer/seconder/owner/due date it cannot support", async () => {
    const segments = [segment({ text: "I move to approve the budget." })];
    const result = await deterministicMinutesGenerator.generate({ meetingTitle: "Board Meeting", segments, fullText: segments[0].text });
    expect(result.motions[0].proposedBy).toBeNull();
    expect(result.motions[0].secondedBy).toBeNull();
  });

  it("leaves agenda empty when none is supplied, rather than inventing one", async () => {
    const result = await deterministicMinutesGenerator.generate({ meetingTitle: "Board Meeting", segments: [], fullText: "" });
    expect(result.agendaItems).toEqual([]);
  });

  it("uses the speaker label map for attendance display names when provided", async () => {
    const segments = [segment({ speakerLabel: "Speaker A", text: "Hello." })];
    const result = await deterministicMinutesGenerator.generate({
      meetingTitle: "Board Meeting",
      segments,
      fullText: "Hello.",
      speakerLabelMap: { "Speaker A": "Alex Chair" },
    });
    expect(result.attendance).toEqual([{ speakerLabel: "Speaker A", attendeeName: "Alex Chair" }]);
  });

  it("produces a fully JSON-serializable result", async () => {
    const segments = [segment({ text: "I move to approve the budget. The motion carries. Meeting adjourned." })];
    const result = await deterministicMinutesGenerator.generate({ meetingTitle: "Board Meeting", segments, fullText: segments[0].text });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;

function mockResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  vi.restoreAllMocks();
});

describe("openAiMinutesGenerator", () => {
  const input = {
    meetingTitle: "Board Meeting",
    segments: [segment({ text: "I move to approve the budget." })],
    fullText: "I move to approve the budget.",
  };

  it("throws MEETING_INTELLIGENCE_GENERATION_FAILED when OPENAI_API_KEY is not configured", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(openAiMinutesGenerator.generate(input)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_GENERATION_FAILED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("parses a valid structured response and always forces status:'draft' server-side", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                motions: [{ text: "I move to approve the budget.", voteResult: "passed", evidence: [{ segmentIndex: 0, startMs: 0, endMs: 1000 }] }],
                decisions: ["Budget approved"],
              }),
            },
          },
        ],
      })
    );
    const result = await openAiMinutesGenerator.generate(input);
    expect(result.status).toBe("draft");
    expect(result.motions[0].voteResult).toBe("passed");
    expect(result.decisions).toEqual(["Budget approved"]);
    expect(result.aiDisclaimer).toMatch(/requires human review/i);
  });

  it("rejects malformed (schema-invalid) AI output safely rather than accepting it", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockResponse(200, { choices: [{ message: { content: JSON.stringify({ motions: "not an array" }) } }] })
    );
    await expect(openAiMinutesGenerator.generate(input)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_GENERATION_FAILED" });
  });

  it("rejects non-JSON content from the model safely", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(200, { choices: [{ message: { content: "not json at all" } }] }));
    await expect(openAiMinutesGenerator.generate(input)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_GENERATION_FAILED" });
  });

  it("maps a 429 to MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(429, {}));
    await expect(openAiMinutesGenerator.generate(input)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED" });
  });

  it("never includes the API key in a thrown error message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(500, {}));
    try {
      await openAiMinutesGenerator.generate(input);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("test-key");
    }
  });
});

describe("resolveMeetingMinutesGenerator", () => {
  it("resolves to the deterministic generator when OPENAI_API_KEY is unset", () => {
    delete process.env.OPENAI_API_KEY;
    expect(resolveMeetingMinutesGenerator().id).toBe("deterministic");
  });

  it("resolves to the OpenAI generator when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "test-key";
    expect(resolveMeetingMinutesGenerator().id).toBe("openai");
  });
});
