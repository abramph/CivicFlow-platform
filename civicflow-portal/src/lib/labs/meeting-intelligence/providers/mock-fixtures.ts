import type { TranscriptResult, TranscriptSegment, TranscriptionRequest } from "./types";

/**
 * Deterministic fixture data shared by both prototype adapters — this spike
 * makes zero real network calls and holds no production API keys, so every
 * "transcription" is generated locally from the request itself. A simple
 * string hash of meetingId+audioUrl picks a synthetic duration and speaker
 * count so repeated calls with the same request are stable (useful for
 * tests and for the UI mock screens), without needing to actually decode
 * an audio file that was never uploaded.
 */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const SAMPLE_LINES = [
  "Let's call this meeting to order.",
  "The minutes from the last meeting were approved as read.",
  "The treasurer's report shows a positive balance for the quarter.",
  "I'd like to propose we table this discussion until next month.",
  "Motion to approve the budget as presented.",
  "Second.",
  "All in favor say aye.",
  "The motion carries.",
  "We need a volunteer to follow up with the vendor by Friday.",
  "I'll take that action item.",
  "Any other business before we adjourn?",
  "Meeting adjourned at the top of the hour.",
];

export function buildMockTranscript(providerId: string, request: TranscriptionRequest): TranscriptResult {
  const seed = hashString(`${request.meetingId}:${request.audioUrl}`);
  const durationMs = 8 * 60_000 + (seed % (52 * 60_000)); // synthetic 8–60 minute meeting
  const speakerCount = request.expectedSpeakerCount ?? 2 + (seed % 4); // synthetic 2–5 speakers
  const speakerLabels = Array.from({ length: speakerCount }, (_, i) => `Speaker ${String.fromCharCode(65 + i)}`);

  const segments: TranscriptSegment[] = [];
  const lineCount = Math.max(6, Math.min(SAMPLE_LINES.length, Math.round(durationMs / (5 * 60_000)) + 6));
  let cursorMs = 0;
  const segmentSpanMs = Math.floor(durationMs / lineCount);

  for (let i = 0; i < lineCount; i += 1) {
    const speakerLabel = speakerLabels[(seed + i) % speakerLabels.length];
    const text = SAMPLE_LINES[i % SAMPLE_LINES.length];
    const startMs = cursorMs;
    const endMs = Math.min(durationMs, cursorMs + segmentSpanMs);
    segments.push({
      speakerLabel,
      startMs,
      endMs,
      text,
      confidence: 0.82 + ((seed + i) % 15) / 100,
    });
    cursorMs = endMs;
  }

  return {
    provider: providerId,
    language: request.languageHint ?? "en",
    durationMs,
    segments,
    fullText: segments.map((s) => s.text).join(" "),
    raw: { mock: true, seed, providerId },
  };
}
