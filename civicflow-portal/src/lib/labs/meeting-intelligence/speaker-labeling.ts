/**
 * Meeting Intelligence Technical Spike — speaker handling.
 *
 * Transcription providers only ever produce anonymous labels ("Speaker A",
 * "Speaker B", ...) — mapping those to real attendee identities is a
 * separate, explicitly human-confirmed step. No biometric voice
 * identification is built or planned for this spike; "future voice
 * identification" below is a documented option, not implemented code.
 */

export type SpeakerMappingMethod = "unassigned" | "attendee_list_order" | "manual" | "voice_id_future";

export interface SpeakerMappingCandidate {
  speakerLabel: string;
  suggestedAttendeeId: string | null;
  suggestedAttendeeName: string | null;
  /** 0–1. Deliberately low/zero for heuristic suggestions — never high enough to justify auto-applying without human confirmation. */
  confidence: number;
  method: SpeakerMappingMethod;
}

export interface Attendee {
  id: string;
  name: string;
}

/**
 * Weakest, cheapest heuristic: assume speakers were introduced/spoke in
 * roughly the order attendees are listed (e.g. an agenda's roll call
 * order). This is a starting suggestion for a human to confirm or correct
 * on the Transcript Review screen — never applied automatically to the
 * official minutes.
 */
export function proposeSpeakerMappingFromAttendeeList(
  speakerLabels: string[],
  attendees: Attendee[]
): SpeakerMappingCandidate[] {
  return speakerLabels.map((speakerLabel, index) => {
    const attendee = attendees[index] ?? null;
    return {
      speakerLabel,
      suggestedAttendeeId: attendee?.id ?? null,
      suggestedAttendeeName: attendee?.name ?? null,
      confidence: attendee ? 0.35 : 0,
      method: attendee ? "attendee_list_order" : "unassigned",
    };
  });
}

/** Applies a secretary's explicit corrections — the only path that ever produces confidence: 1. */
export function applyManualSpeakerMapping(
  candidates: SpeakerMappingCandidate[],
  overrides: Record<string, Attendee>
): SpeakerMappingCandidate[] {
  return candidates.map((candidate) => {
    const override = overrides[candidate.speakerLabel];
    if (!override) return candidate;
    return {
      ...candidate,
      suggestedAttendeeId: override.id,
      suggestedAttendeeName: override.name,
      confidence: 1,
      method: "manual",
    };
  });
}

/**
 * Documented for a future phase — NOT implemented. Voice-print/biometric
 * speaker identification (matching a voice signature across meetings to
 * the same person without a human confirming it each time) raises
 * meaningfully different privacy and consent requirements than the
 * per-meeting manual-confirmation model above and must not be treated as
 * a drop-in upgrade. Any future implementation would need its own explicit
 * consent flow, retention policy for voice signatures, and opt-out — this
 * spike takes no position on whether to build it, only flags that it is
 * out of scope here.
 */
export const VOICE_IDENTIFICATION_STATUS = "not_implemented" as const;
