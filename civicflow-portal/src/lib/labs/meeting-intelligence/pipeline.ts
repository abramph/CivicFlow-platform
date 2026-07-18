import { getMeetingTranscriptionProvider, resolveDefaultProviderId, type ProviderId, type TranscriptResult } from "./providers";
import { proposeSpeakerMappingFromAttendeeList, type Attendee, type SpeakerMappingCandidate } from "./speaker-labeling";
import { generateDraftMinutes, type DraftMinutes } from "./minutes-generator";
import { estimateMeetingCostCents, type MeetingCostBreakdownCents } from "./cost-model";

/**
 * Meeting Intelligence Technical Spike — end-to-end orchestration.
 *
 * Wires every prototype piece together (provider abstraction, speaker
 * mapping, minutes generation, cost estimation) into the single call the
 * mock UI screens and tests use — proving the pieces compose into one
 * workflow, not just that each exists in isolation. This function makes no
 * external network call (the provider's transcribe() is itself a local
 * mock) and writes nothing to the database on its own — callers decide
 * whether/how to persist a result.
 */

export interface MeetingIntelligenceSpikeInput {
  organizationId: string;
  meetingId: string;
  meetingTitle: string;
  /** A synthetic identifier standing in for a signed recording URL — no real audio is fetched. */
  audioUrl: string;
  providerId?: ProviderId;
  attendees?: Attendee[];
  agenda?: string[];
}

export interface MeetingIntelligenceSpikeResult {
  providerId: ProviderId;
  transcript: TranscriptResult;
  speakerMapping: SpeakerMappingCandidate[];
  draftMinutes: DraftMinutes;
  costCents: MeetingCostBreakdownCents;
  processingMs: number;
}

export async function runMeetingIntelligenceSpikePipeline(
  input: MeetingIntelligenceSpikeInput
): Promise<MeetingIntelligenceSpikeResult> {
  const providerId = input.providerId ?? resolveDefaultProviderId();
  const provider = getMeetingTranscriptionProvider(providerId);

  const startedAt = Date.now();
  const transcript = await provider.transcribe({
    audioUrl: input.audioUrl,
    organizationId: input.organizationId,
    meetingId: input.meetingId,
    expectedSpeakerCount: input.attendees?.length,
  });
  const processingMs = Date.now() - startedAt;

  const speakerLabels = Array.from(new Set(transcript.segments.map((segment) => segment.speakerLabel)));
  const speakerMapping = input.attendees
    ? proposeSpeakerMappingFromAttendeeList(speakerLabels, input.attendees)
    : speakerLabels.map((speakerLabel) => ({
        speakerLabel,
        suggestedAttendeeId: null,
        suggestedAttendeeName: null,
        confidence: 0,
        method: "unassigned" as const,
      }));

  const draftMinutes = generateDraftMinutes(transcript, {
    meetingTitle: input.meetingTitle,
    agenda: input.agenda,
    attendees: speakerMapping.map((mapping) => ({
      speakerLabel: mapping.speakerLabel,
      attendeeName: mapping.suggestedAttendeeName,
    })),
  });

  const costCents = estimateMeetingCostCents(transcript.durationMs, providerId);

  return { providerId, transcript, speakerMapping, draftMinutes, costCents, processingMs };
}
