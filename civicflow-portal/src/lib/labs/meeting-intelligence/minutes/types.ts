import type { TranscriptSegment } from "../providers/async-types";

/**
 * Meeting Intelligence MVP — the structured minutes contract. Every field
 * below is nullable/optional except the always-present skeleton
 * (meetingTitle, status, aiDisclaimer) — a transcript that doesn't support
 * a field must leave it null/empty, never fabricate a plausible-looking
 * value. See docs/meeting-intelligence.md's "no fabrication" policy.
 */

export interface EvidenceReference {
  /** Index into the transcript's segments array this claim is drawn from — lets a reviewer jump straight to the supporting audio/text. */
  segmentIndex: number;
  startMs: number;
  endMs: number;
}

export interface StructuredMotion {
  text: string;
  proposedBy: string | null;
  secondedBy: string | null;
  voteResult: "passed" | "failed" | "unrecorded";
  evidence: EvidenceReference[];
}

export interface StructuredActionItem {
  description: string;
  owner: string | null;
  dueDate: string | null;
  evidence: EvidenceReference[];
}

export interface StructuredMeetingMinutes {
  meetingTitle: string;
  meetingDate: string | null;
  locationOrFormat: string | null;
  attendance: { speakerLabel: string; attendeeName: string | null }[];
  agendaItems: string[];
  discussionSummaries: { topic: string; summary: string; evidence: EvidenceReference[] }[];
  motions: StructuredMotion[];
  decisions: string[];
  actionItems: StructuredActionItem[];
  unresolvedIssues: string[];
  nextMeetingDetails: string | null;
  adjournmentTime: string | null;
  executiveSummary: string | null;
  /** Always "draft" — no generator in this module produces anything else. */
  status: "draft";
  aiDisclaimer: string;
}

export const AI_GENERATED_DISCLAIMER =
  "AI-generated draft — requires human review. This content was produced automatically from a transcript and has not been verified for accuracy.";

export interface MeetingMinutesGenerationInput {
  meetingTitle: string;
  meetingDate?: string | null;
  locationOrFormat?: string | null;
  agendaItems?: string[];
  segments: TranscriptSegment[];
  fullText: string;
  speakerLabelMap?: Record<string, string>;
}

export interface MeetingMinutesGenerator {
  readonly id: string;
  generate(input: MeetingMinutesGenerationInput): Promise<StructuredMeetingMinutes>;
}
