import type { MeetingTranscriptionProvider } from "./types";
import { openAiProvider } from "./openai-provider";
import { assemblyAiProvider } from "./assemblyai-provider";

export type { MeetingTranscriptionProvider, TranscriptResult, TranscriptSegment, TranscriptionRequest, ProviderCapabilities } from "./types";

const PROVIDERS: Record<string, MeetingTranscriptionProvider> = {
  openai: openAiProvider,
  assemblyai: assemblyAiProvider,
};

export type ProviderId = keyof typeof PROVIDERS;

export function listMeetingTranscriptionProviders(): MeetingTranscriptionProvider[] {
  return Object.values(PROVIDERS);
}

export function getMeetingTranscriptionProvider(providerId: string): MeetingTranscriptionProvider {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown meeting transcription provider: ${providerId}`);
  }
  return provider;
}

/**
 * Selects the active provider — never hard-coded at a call site. Reads an
 * env var so the choice can change per environment/config without a code
 * change; defaults to the provider this spike recommends (see
 * docs/meeting-intelligence-spike.md's provider comparison — AssemblyAI,
 * for native diarization and webhook-driven async processing that fits a
 * background-queue architecture better than a synchronous API).
 */
export function resolveDefaultProviderId(): ProviderId {
  const configured = process.env.MEETING_INTELLIGENCE_PROVIDER;
  if (configured && configured in PROVIDERS) return configured as ProviderId;
  return "assemblyai";
}
