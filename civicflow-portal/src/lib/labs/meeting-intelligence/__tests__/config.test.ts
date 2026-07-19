import { afterEach, describe, expect, it } from "vitest";
import { getOpenAiApiKey, requireAssemblyAiApiKey, resolveMeetingIntelligenceProviderId } from "../config";
import { getMeetingTranscriptionProvider } from "../providers/async-index";
import { MeetingIntelligenceError } from "../errors";

const originalAssemblyAiKey = process.env.ASSEMBLYAI_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalProvider = process.env.MEETING_INTELLIGENCE_PROVIDER;

afterEach(() => {
  if (originalAssemblyAiKey === undefined) delete process.env.ASSEMBLYAI_API_KEY;
  else process.env.ASSEMBLYAI_API_KEY = originalAssemblyAiKey;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalProvider === undefined) delete process.env.MEETING_INTELLIGENCE_PROVIDER;
  else process.env.MEETING_INTELLIGENCE_PROVIDER = originalProvider;
});

describe("resolveMeetingIntelligenceProviderId", () => {
  it("defaults to assemblyai when unset", () => {
    delete process.env.MEETING_INTELLIGENCE_PROVIDER;
    expect(resolveMeetingIntelligenceProviderId()).toBe("assemblyai");
  });

  it("respects a valid configured value", () => {
    process.env.MEETING_INTELLIGENCE_PROVIDER = "assemblyai";
    expect(resolveMeetingIntelligenceProviderId()).toBe("assemblyai");
  });

  it("fails loudly (does not silently fall back) for an invalid configured value", () => {
    process.env.MEETING_INTELLIGENCE_PROVIDER = "not-a-real-provider";
    expect(() => resolveMeetingIntelligenceProviderId()).toThrow(MeetingIntelligenceError);
    try {
      resolveMeetingIntelligenceProviderId();
      throw new Error("expected resolveMeetingIntelligenceProviderId to throw");
    } catch (error) {
      expect((error as MeetingIntelligenceError).code).toBe("MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED");
      expect((error as MeetingIntelligenceError).retryable).toBe(false);
    }
  });

  it("every known provider id resolves a real registered provider (catches drift vs. providers/async-index.ts)", () => {
    process.env.MEETING_INTELLIGENCE_PROVIDER = "assemblyai";
    const id = resolveMeetingIntelligenceProviderId();
    expect(() => getMeetingTranscriptionProvider(id)).not.toThrow();
  });
});

describe("requireAssemblyAiApiKey", () => {
  it("throws a non-retryable MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED error when unset", () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    try {
      requireAssemblyAiApiKey();
      throw new Error("expected requireAssemblyAiApiKey to throw");
    } catch (error) {
      expect((error as MeetingIntelligenceError).code).toBe("MEETING_INTELLIGENCE_PROVIDER_MISCONFIGURED");
      expect((error as MeetingIntelligenceError).retryable).toBe(false);
    }
  });

  it("never includes the configured key value in its error message", () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    try {
      requireAssemblyAiApiKey();
    } catch (error) {
      expect((error as Error).message).not.toContain("sk-");
      expect((error as Error).message).toMatch(/not configured/);
    }
  });

  it("returns the configured key when set", () => {
    process.env.ASSEMBLYAI_API_KEY = "test-assemblyai-key";
    expect(requireAssemblyAiApiKey()).toBe("test-assemblyai-key");
  });
});

describe("getOpenAiApiKey", () => {
  it("returns undefined when unset", () => {
    delete process.env.OPENAI_API_KEY;
    expect(getOpenAiApiKey()).toBeUndefined();
  });

  it("returns undefined for an empty string (treated as unset)", () => {
    process.env.OPENAI_API_KEY = "";
    expect(getOpenAiApiKey()).toBeUndefined();
  });

  it("returns the configured key when set", () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    expect(getOpenAiApiKey()).toBe("test-openai-key");
  });
});
