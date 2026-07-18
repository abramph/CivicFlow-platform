import { afterEach, describe, expect, it } from "vitest";
import {
  getMeetingTranscriptionProvider,
  listMeetingTranscriptionProviders,
  resolveDefaultProviderId,
} from "../providers";

describe("Meeting Intelligence provider abstraction", () => {
  it("lists exactly the two prototyped providers", () => {
    const providers = listMeetingTranscriptionProviders();
    expect(providers.map((p) => p.id).sort()).toEqual(["assemblyai", "openai"]);
  });

  it("getMeetingTranscriptionProvider resolves a known id", () => {
    const provider = getMeetingTranscriptionProvider("assemblyai");
    expect(provider.displayName).toMatch(/AssemblyAI/);
  });

  it("throws for an unknown provider id rather than silently returning undefined", () => {
    expect(() => getMeetingTranscriptionProvider("notARealProvider")).toThrow(/Unknown meeting transcription provider/);
  });

  it("AssemblyAI advertises native speaker diarization; OpenAI does not", () => {
    expect(getMeetingTranscriptionProvider("assemblyai").capabilities.speakerDiarization).toBe(true);
    expect(getMeetingTranscriptionProvider("openai").capabilities.speakerDiarization).toBe(false);
  });

  it("AssemblyAI advertises webhook support; OpenAI's synchronous API does not", () => {
    expect(getMeetingTranscriptionProvider("assemblyai").capabilities.webhookSupport).toBe(true);
    expect(getMeetingTranscriptionProvider("openai").capabilities.webhookSupport).toBe(false);
  });

  it("every provider supports the required upload formats", () => {
    for (const provider of listMeetingTranscriptionProviders()) {
      for (const format of ["mp3", "wav", "m4a", "mp4", "webm"]) {
        expect(provider.capabilities.supportedFormats).toContain(format);
      }
    }
  });

  it("estimateCostCents scales linearly with duration and is always positive", () => {
    for (const provider of listMeetingTranscriptionProviders()) {
      const cost30 = provider.estimateCostCents(30 * 60_000);
      const cost60 = provider.estimateCostCents(60 * 60_000);
      expect(cost30).toBeGreaterThan(0);
      expect(cost60).toBeCloseTo(cost30 * 2, 5);
    }
  });

  it("transcribe() returns a deterministic result for the same request (no real network call)", async () => {
    const provider = getMeetingTranscriptionProvider("assemblyai");
    const request = { audioUrl: "synthetic://meeting-1", organizationId: "org-a", meetingId: "meeting-1" };
    const first = await provider.transcribe(request);
    const second = await provider.transcribe(request);
    expect(first).toEqual(second);
    expect(first.provider).toBe("assemblyai");
    expect(first.segments.length).toBeGreaterThan(0);
  });

  it("transcribe() respects an explicit expectedSpeakerCount", async () => {
    const provider = getMeetingTranscriptionProvider("openai");
    const result = await provider.transcribe({
      audioUrl: "synthetic://meeting-2",
      organizationId: "org-a",
      meetingId: "meeting-2",
      expectedSpeakerCount: 3,
    });
    const distinctSpeakers = new Set(result.segments.map((s) => s.speakerLabel));
    expect(distinctSpeakers.size).toBeLessThanOrEqual(3);
  });
});

describe("resolveDefaultProviderId", () => {
  const originalEnv = process.env.MEETING_INTELLIGENCE_PROVIDER;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MEETING_INTELLIGENCE_PROVIDER;
    else process.env.MEETING_INTELLIGENCE_PROVIDER = originalEnv;
  });

  it("defaults to assemblyai when unset", () => {
    delete process.env.MEETING_INTELLIGENCE_PROVIDER;
    expect(resolveDefaultProviderId()).toBe("assemblyai");
  });

  it("respects a valid configured override — the provider is never hard-coded", () => {
    process.env.MEETING_INTELLIGENCE_PROVIDER = "openai";
    expect(resolveDefaultProviderId()).toBe("openai");
  });

  it("falls back to the default for an invalid configured value", () => {
    process.env.MEETING_INTELLIGENCE_PROVIDER = "not-a-real-provider";
    expect(resolveDefaultProviderId()).toBe("assemblyai");
  });
});
