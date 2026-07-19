import { MeetingIntelligenceError } from "../errors";
import { requireAssemblyAiApiKey } from "../config";
import type {
  MeetingTranscriptionProvider,
  TranscriptSegment,
  TranscriptionRequest,
  TranscriptionStatus,
  TranscriptionSubmission,
} from "./async-types";

/**
 * Real AssemblyAI adapter — the MVP's first production transcription
 * provider. No credentials are hardcoded; ASSEMBLYAI_API_KEY is read via
 * config.ts's requireAssemblyAiApiKey() only at call time, so a missing key
 * never breaks app-wide boot, only this feature when actually used. Uses
 * `fetch` directly (no vendor SDK dependency) so the request/response shape
 * is fully visible and testable with a mocked `fetch` — no real network call
 * is ever made in tests.
 */

const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2";
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_TIMEOUT", "The transcription provider did not respond in time.");
    }
    // Never surface the raw network error message (may contain internal
    // hostnames/URLs) — a stable, generic code and message only.
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE", "Unable to reach the transcription provider.");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUtterances(utterances: Array<{ speaker?: string; start: number; end: number; text: string; confidence?: number }>): TranscriptSegment[] {
  return utterances.map((utterance) => ({
    speakerLabel: `Speaker ${utterance.speaker ?? "A"}`,
    startMs: utterance.start,
    endMs: utterance.end,
    text: utterance.text,
    confidence: utterance.confidence,
  }));
}

export const assemblyAiTranscriptionProvider: MeetingTranscriptionProvider = {
  id: "assemblyai",
  displayName: "AssemblyAI",

  async submit(request: TranscriptionRequest): Promise<TranscriptionSubmission> {
    const apiKey = requireAssemblyAiApiKey();
    const response = await fetchWithTimeout(`${ASSEMBLYAI_BASE_URL}/transcript`, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: request.audioUrl,
        speaker_labels: true,
        language_code: request.languageHint ?? "en",
        ...(request.expectedSpeakerCount ? { speakers_expected: request.expectedSpeakerCount } : {}),
      }),
    });

    if (response.status === 429) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED", "Transcription provider rate limit exceeded. Please retry shortly.");
    }
    if (response.status === 400 || response.status === 422) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FILE_UNSUPPORTED", "The transcription provider rejected this recording as unsupported or invalid media.");
    }
    if (!response.ok) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE", `Transcription provider returned an unexpected error (${response.status}).`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", "Transcription provider returned an unparseable response.");
    }
    const externalJobId = (body as { id?: unknown })?.id;
    if (typeof externalJobId !== "string" || !externalJobId) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", "Transcription provider response did not include a job id.");
    }

    return { externalJobId, status: "queued" };
  },

  async getStatus(externalJobId: string): Promise<TranscriptionStatus> {
    const apiKey = requireAssemblyAiApiKey();
    const response = await fetchWithTimeout(`${ASSEMBLYAI_BASE_URL}/transcript/${encodeURIComponent(externalJobId)}`, {
      method: "GET",
      headers: { Authorization: apiKey },
    });

    if (response.status === 429) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_RATE_LIMITED", "Transcription provider rate limit exceeded. Please retry shortly.");
    }
    if (!response.ok) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE", `Transcription provider returned an unexpected error (${response.status}).`);
    }

    let body: {
      status?: string;
      error?: string;
      language_code?: string;
      audio_duration?: number;
      text?: string;
      utterances?: Array<{ speaker?: string; start: number; end: number; text: string; confidence?: number }>;
    };
    try {
      body = await response.json();
    } catch {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", "Transcription provider returned an unparseable response.");
    }

    if (body.status === "error") {
      return { status: "error", errorMessage: typeof body.error === "string" ? body.error : "Transcription failed." };
    }
    if (body.status === "queued") return { status: "queued" };
    if (body.status === "processing") return { status: "processing" };
    if (body.status === "completed") {
      const segments = normalizeUtterances(body.utterances ?? []);
      return {
        status: "completed",
        result: {
          language: body.language_code ?? "en",
          durationMs: Math.round((body.audio_duration ?? 0) * 1000),
          fullText: body.text ?? "",
          segments,
          speakerCount: new Set(segments.map((segment) => segment.speakerLabel)).size,
        },
      };
    }

    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", `Transcription provider returned an unrecognized status: ${String(body.status)}.`);
  },

  // AssemblyAI has no true "cancel an in-flight job" endpoint — its DELETE
  // /v2/transcript/{id} only removes data for an *already-completed* job,
  // it does not stop in-progress processing. Documented limitation: a
  // CANCELLED job in our own workflow simply stops polling and never
  // reads the result, rather than actually halting vendor-side work — see
  // docs/meeting-intelligence.md.
};
