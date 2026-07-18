import type { MeetingTranscriptionProvider, ProviderCapabilities, TranscriptionRequest } from "./types";
import { buildMockTranscript } from "./mock-fixtures";

/**
 * Prototype adapter only — no AssemblyAI SDK is imported, no API key is
 * read, no network call is made. Capability figures reflect AssemblyAI's
 * publicly documented Speech-to-Text API as of general knowledge; confirm
 * current specifics directly with AssemblyAI before any production
 * commitment (see docs/meeting-intelligence-spike.md's provider comparison).
 */
const CAPABILITIES: ProviderCapabilities = {
  // Native speaker diarization is AssemblyAI's headline advantage for this
  // use case — no separate diarization pass needed.
  speakerDiarization: true,
  supportedFormats: ["mp3", "mp4", "m4a", "wav", "webm"],
  webhookSupport: true, // async job submission + webhook-on-completion model, well suited to a background-queue architecture
  maxFileSizeMb: 2048,
  averageProcessingSpeedRatio: 0.15,
  enterpriseReadiness: "high",
  privacyControls: [
    "SOC 2 Type II",
    "HIPAA-eligible tier available (BAA on request)",
    "EU data residency option",
  ],
};

// Illustrative, approximate — confirm current published rate before committing.
const APPROX_CENTS_PER_MINUTE = 0.45;

export const assemblyAiProvider: MeetingTranscriptionProvider = {
  id: "assemblyai",
  displayName: "AssemblyAI (Speech-to-Text, diarization enabled)",
  capabilities: CAPABILITIES,
  async transcribe(request: TranscriptionRequest) {
    return buildMockTranscript("assemblyai", request);
  },
  estimateCostCents(durationMs: number): number {
    return (durationMs / 60_000) * APPROX_CENTS_PER_MINUTE;
  },
};
