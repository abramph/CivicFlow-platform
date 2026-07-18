import type { TranscriptResult } from "./providers/types";

/**
 * Meeting Intelligence Technical Spike — draft minutes generator.
 *
 * This prototype uses deterministic keyword/pattern extraction rather than
 * a real LLM call — it exists to prove out and test the *structured output
 * contract* a production implementation must fill (a real implementation
 * would replace the extraction functions below with a single structured-
 * output LLM call using this same DraftMinutes shape as its JSON schema),
 * without requiring AI provider credentials in this spike and without
 * making any external API call from tests. `status` is hard-coded to
 * "draft" and there is no function anywhere in this module — or this
 * entire spike — that can change it to anything else. Promotion to
 * official minutes is a human action outside this module's scope.
 */

export interface DraftMinutesAttendanceRow {
  speakerLabel: string;
  attendeeName: string | null;
}

export interface DraftMinutesMotion {
  text: string;
  movedBy: string | null;
  secondedBy: string | null;
}

export interface DraftMinutesVote {
  motionText: string;
  result: "passed" | "failed" | "unrecorded";
}

export interface DraftMinutesActionItem {
  description: string;
  owner: string | null;
  dueDate: string | null;
}

export interface DraftMinutes {
  meetingTitle: string;
  generatedAt: string;
  /** Always "draft" — this generator has no path to producing anything else. */
  status: "draft";
  attendance: DraftMinutesAttendanceRow[];
  agenda: string[];
  discussionSummaries: { topic: string; summary: string }[];
  motions: DraftMinutesMotion[];
  votes: DraftMinutesVote[];
  actionItems: DraftMinutesActionItem[];
  decisions: string[];
  unresolvedIssues: string[];
  followUpTasks: string[];
  adjournment: { mentioned: boolean };
  aiDisclaimer: string;
}

export const AI_MINUTES_DISCLAIMER =
  "These minutes were drafted with AI assistance from an automated transcript. They are not official until reviewed, edited as needed, and approved by a meeting secretary or authorized officer.";

function findSentencesContaining(fullText: string, keywords: string[]): string[] {
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  return sentences.filter((sentence) => keywords.some((keyword) => sentence.toLowerCase().includes(keyword)));
}

function extractMotions(fullText: string): DraftMinutesMotion[] {
  return findSentencesContaining(fullText, ["motion to", "i move", "moved that"]).map((text) => ({
    text: text.trim(),
    movedBy: null,
    secondedBy: null,
  }));
}

function extractVotes(fullText: string, motions: DraftMinutesMotion[]): DraftMinutesVote[] {
  const carried = /the motion carries|all in favor|motion passed/i.test(fullText);
  const failed = /motion (fails|failed)|opposed/i.test(fullText) && !carried;
  return motions.map((motion) => ({
    motionText: motion.text,
    result: carried ? "passed" : failed ? "failed" : "unrecorded",
  }));
}

function extractActionItems(fullText: string): DraftMinutesActionItem[] {
  return findSentencesContaining(fullText, ["action item", "i'll take that", "will follow up", "by friday", "by next"]).map((text) => ({
    description: text.trim(),
    owner: null,
    dueDate: null,
  }));
}

function extractDecisions(fullText: string): string[] {
  return findSentencesContaining(fullText, ["approved", "the motion carries", "we agreed"]).map((s) => s.trim());
}

function extractUnresolvedIssues(fullText: string): string[] {
  return findSentencesContaining(fullText, ["table this", "tabled", "revisit", "unresolved", "still need to decide"]).map((s) => s.trim());
}

function extractFollowUpTasks(fullText: string): string[] {
  return findSentencesContaining(fullText, ["follow up", "next steps", "before next meeting"]).map((s) => s.trim());
}

export function generateDraftMinutes(
  transcript: TranscriptResult,
  meetingContext: {
    meetingTitle: string;
    agenda?: string[];
    attendees?: { speakerLabel: string; attendeeName: string | null }[];
  }
): DraftMinutes {
  const motions = extractMotions(transcript.fullText);

  return {
    meetingTitle: meetingContext.meetingTitle,
    generatedAt: new Date().toISOString(),
    status: "draft",
    attendance:
      meetingContext.attendees ??
      Array.from(new Set(transcript.segments.map((s) => s.speakerLabel))).map((speakerLabel) => ({
        speakerLabel,
        attendeeName: null,
      })),
    agenda: meetingContext.agenda ?? [],
    discussionSummaries: [
      {
        topic: "General discussion",
        summary: transcript.fullText.length > 400 ? `${transcript.fullText.slice(0, 400)}...` : transcript.fullText,
      },
    ],
    motions,
    votes: extractVotes(transcript.fullText, motions),
    actionItems: extractActionItems(transcript.fullText),
    decisions: extractDecisions(transcript.fullText),
    unresolvedIssues: extractUnresolvedIssues(transcript.fullText),
    followUpTasks: extractFollowUpTasks(transcript.fullText),
    adjournment: { mentioned: /adjourn/i.test(transcript.fullText) },
    aiDisclaimer: AI_MINUTES_DISCLAIMER,
  };
}
