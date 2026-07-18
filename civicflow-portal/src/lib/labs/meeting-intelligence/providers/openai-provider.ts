import type { MeetingTranscriptionProvider, ProviderCapabilities, TranscriptionRequest } from "./types";
import { buildMockTranscript } from "./mock-fixtures";

/**
 * Prototype adapter only — no OpenAI SDK is imported, no API key is read,
 * no network call is made. Capability figures reflect OpenAI's publicly
 * documented Whisper/gpt-4o-transcribe API as of general knowledge; confirm
 * current specifics directly with OpenAI before any production commitment
 * (see docs/meeting-intelligence-spike.md's provider comparison).
 */
const CAPABILITIES: ProviderCapabilities = {
  // OpenAI's transcription API returns plain text/segments, not per-speaker
  // labels — diarization would need a separate step (e.g. pyannote) layered
  // on top, which is the single biggest architectural cost of choosing it.
  speakerDiarization: false,
  supportedFormats: ["mp3", "mp4", "m4a", "wav", "webm"],
  webhookSupport: false, // synchronous request/response API — no native async job + webhook model
  maxFileSizeMb: 25,
  averageProcessingSpeedRatio: 0.12,
  enterpriseReadiness: "high",
  privacyControls: [
    "Zero data retention available on eligible API tiers",
    "SOC 2 Type II",
    "No training on API inputs/outputs by default (per OpenAI's API data usage policy)",
  ],
};

// Illustrative, approximate — confirm current published rate before committing.
const APPROX_CENTS_PER_MINUTE = 0.6;

export const openAiProvider: MeetingTranscriptionProvider = {
  id: "openai",
  displayName: "OpenAI (Whisper / gpt-4o-transcribe)",
  capabilities: CAPABILITIES,
  async transcribe(request: TranscriptionRequest) {
    return buildMockTranscript("openai", request);
  },
  estimateCostCents(durationMs: number): number {
    return (durationMs / 60_000) * APPROX_CENTS_PER_MINUTE;
  },
};
