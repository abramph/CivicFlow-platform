import { assemblyAiTranscriptionProvider } from "./assemblyai-adapter";
import type { MeetingTranscriptionProvider } from "./async-types";

export type {
  MeetingTranscriptionProvider,
  TranscriptSegment,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptionStatus,
  TranscriptionSubmission,
} from "./async-types";

const PROVIDERS: Record<string, MeetingTranscriptionProvider> = {
  assemblyai: assemblyAiTranscriptionProvider,
};

export type MeetingIntelligenceProviderId = keyof typeof PROVIDERS;

export function isMeetingIntelligenceProviderId(id: string): id is MeetingIntelligenceProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id);
}

export function getMeetingTranscriptionProvider(id: string): MeetingTranscriptionProvider {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Unknown Meeting Intelligence transcription provider: ${id}`);
  }
  return provider;
}

/**
 * Selects the active provider via configuration — never hard-coded at a
 * call site. AssemblyAI is the only real adapter implemented in the MVP;
 * MEETING_INTELLIGENCE_PROVIDER exists so a second provider can be added
 * and switched to later without touching any calling code.
 */
export function resolveMeetingIntelligenceProviderId(): MeetingIntelligenceProviderId {
  const configured = process.env.MEETING_INTELLIGENCE_PROVIDER;
  if (configured && isMeetingIntelligenceProviderId(configured)) return configured;
  return "assemblyai";
}
