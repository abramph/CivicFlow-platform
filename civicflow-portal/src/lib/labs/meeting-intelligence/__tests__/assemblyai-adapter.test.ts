import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assemblyAiTranscriptionProvider } from "../providers/assemblyai-adapter";
import { MeetingIntelligenceError } from "../errors";

const originalFetch = global.fetch;
const originalApiKey = process.env.ASSEMBLYAI_API_KEY;

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  process.env.ASSEMBLYAI_API_KEY = "test-key";
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.ASSEMBLYAI_API_KEY;
  else process.env.ASSEMBLYAI_API_KEY = originalApiKey;
  vi.restoreAllMocks();
});

const request = {
  organizationId: "aph-org",
  jobId: "job-1",
  meetingId: "meeting-1",
  audioUrl: "https://signed.example/recording.wav",
};

describe("assemblyAiTranscriptionProvider.submit", () => {
  it("throws MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE when ASSEMBLYAI_API_KEY is not configured", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    await expect(assemblyAiTranscriptionProvider.submit(request)).rejects.toMatchObject({
      code: "MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits with speaker_labels enabled and returns the external job id — no real network call", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(200, { id: "external-job-1" }));
    const result = await assemblyAiTranscriptionProvider.submit(request);
    expect(result).toEqual({ externalJobId: "external-job-1", status: "queued" });

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("https://api.assemblyai.com/v2/transcript");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.speaker_labels).toBe(true);
    expect(body.audio_url).toBe(request.audioUrl);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "test-key" });
  });

  it("never logs or includes the signed URL or API key in a thrown error message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(500, {}));
    try {
      await assemblyAiTranscriptionProvider.submit(request);
      expect.fail("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("test-key");
      expect(message).not.toContain(request.audioUrl);
    }
  });

  it("maps a 429 to MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(429, {}));
    await expect(assemblyAiTranscriptionProvider.submit(request)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED" });
  });

  it("maps a 400 (unsupported/invalid media) to MEETING_INTELLIGENCE_FILE_UNSUPPORTED", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(400, {}));
    await expect(assemblyAiTranscriptionProvider.submit(request)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_FILE_UNSUPPORTED" });
  });

  it("maps an unexpected 500 to MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(500, {}));
    await expect(assemblyAiTranscriptionProvider.submit(request)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE" });
  });

  it("rejects a response missing a job id as MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(200, {}));
    await expect(assemblyAiTranscriptionProvider.submit(request)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE" });
  });

  it("maps a network failure to MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(assemblyAiTranscriptionProvider.submit(request)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE" });
  });

  it("maps an aborted (timeout) request to MEETING_INTELLIGENCE_PROVIDER_TIMEOUT", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    vi.mocked(global.fetch).mockRejectedValueOnce(abortError);
    await expect(assemblyAiTranscriptionProvider.submit(request)).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_PROVIDER_TIMEOUT" });
  });
});

describe("assemblyAiTranscriptionProvider.getStatus", () => {
  it("returns queued/processing while the job is in flight", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(200, { status: "queued" }));
    expect(await assemblyAiTranscriptionProvider.getStatus("ext-1")).toEqual({ status: "queued" });

    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(200, { status: "processing" }));
    expect(await assemblyAiTranscriptionProvider.getStatus("ext-1")).toEqual({ status: "processing" });
  });

  it("normalizes a completed response into segments with 'Speaker X' labels", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockResponse(200, {
        status: "completed",
        language_code: "en",
        audio_duration: 120.5,
        text: "Hello there. General discussion.",
        utterances: [
          { speaker: "A", start: 0, end: 1000, text: "Hello there.", confidence: 0.95 },
          { speaker: "B", start: 1000, end: 2000, text: "General discussion.", confidence: 0.9 },
        ],
      })
    );
    const result = await assemblyAiTranscriptionProvider.getStatus("ext-1");
    expect(result.status).toBe("completed");
    expect(result.result?.segments).toEqual([
      { speakerLabel: "Speaker A", startMs: 0, endMs: 1000, text: "Hello there.", confidence: 0.95 },
      { speakerLabel: "Speaker B", startMs: 1000, endMs: 2000, text: "General discussion.", confidence: 0.9 },
    ]);
    expect(result.result?.speakerCount).toBe(2);
    expect(result.result?.durationMs).toBe(120500);
  });

  it("returns an error status with a message when the provider reports a failure", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(200, { status: "error", error: "invalid audio format" }));
    const result = await assemblyAiTranscriptionProvider.getStatus("ext-1");
    expect(result).toEqual({ status: "error", errorMessage: "invalid audio format" });
  });

  it("throws MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE for an unrecognized status value", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(200, { status: "something-new" }));
    await expect(assemblyAiTranscriptionProvider.getStatus("ext-1")).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE" });
  });

  it("maps a 429 to MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(429, {}));
    await expect(assemblyAiTranscriptionProvider.getStatus("ext-1")).rejects.toMatchObject({ code: "MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED" });
  });
});

describe("cancel", () => {
  it("is not implemented — documented limitation, not a silent no-op that pretends to succeed", () => {
    expect(assemblyAiTranscriptionProvider.cancel).toBeUndefined();
  });
});

describe("MeetingIntelligenceError shape", () => {
  it("every thrown error is an instance of MeetingIntelligenceError with a stable code and status", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(mockResponse(429, {}));
    try {
      await assemblyAiTranscriptionProvider.submit(request);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MeetingIntelligenceError);
      expect((error as MeetingIntelligenceError).status).toBe(429);
      expect((error as MeetingIntelligenceError).retryable).toBe(true);
    }
  });
});
