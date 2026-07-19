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

// resolveMeetingIntelligenceProviderId() (reads MEETING_INTELLIGENCE_PROVIDER,
// validates it) lives in ../config.ts, not here — see that file's comment on
// why all Meeting Intelligence env reads are centralized in one place.
// Not re-exported from here to avoid a circular import (config.ts imports
// isMeetingIntelligenceProviderId from this file) — import it from ../config directly.
