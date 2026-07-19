import type { TranscriptSegment } from "../providers/async-types";
import {
  DETERMINISTIC_FALLBACK_DISCLAIMER,
  type EvidenceReference,
  type MeetingMinutesGenerationInput,
  type MeetingMinutesGenerator,
  type StructuredActionItem,
  type StructuredMeetingMinutes,
  type StructuredMotion,
} from "./types";

/**
 * Deterministic, non-AI fallback generator — used for local development
 * when OPENAI_API_KEY is not configured (see ./index.ts). Extracts only
 * what keyword/pattern matching actually finds in the transcript;
 * everything else is left null/empty rather than guessed. This is not a
 * "worse AI" — it makes zero inferences at all, which is exactly why it's
 * safe to run without review of a live model's output.
 */

function findMatchingSegments(segments: TranscriptSegment[], keywords: string[]): { segment: TranscriptSegment; index: number }[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => keywords.some((keyword) => segment.text.toLowerCase().includes(keyword)));
}

function toEvidence(index: number, segment: TranscriptSegment): EvidenceReference {
  return { segmentIndex: index, startMs: segment.startMs, endMs: segment.endMs };
}

/**
 * Vote-outcome detection is scoped to the window between this motion and
 * the next one (or the end of the transcript) — never the whole document.
 * A meeting can contain several motions with different outcomes; matching
 * a "the motion carries"/"motion failed" phrase anywhere in the full text
 * and applying it to every motion would misattribute the wrong outcome to
 * some of them. That's not extraction, it's a fabricated inference — and
 * the whole point of this generator is to make none.
 */
function extractMotions(segments: TranscriptSegment[]): StructuredMotion[] {
  const matches = findMatchingSegments(segments, ["motion to", "i move", "moved that"]);
  return matches.map(({ segment, index }, matchPosition) => {
    const nextMotionIndex = matches[matchPosition + 1]?.index ?? segments.length;
    const windowText = segments
      .slice(index, nextMotionIndex)
      .map((s) => s.text)
      .join(" ");
    const carried = /the motion carries|all in favor|motion passed/i.test(windowText);
    const failed = /motion (fails|failed)|opposed/i.test(windowText) && !carried;
    return {
      text: segment.text.trim(),
      proposedBy: null,
      secondedBy: null,
      voteResult: carried ? "passed" : failed ? "failed" : "unrecorded",
      evidence: [toEvidence(index, segment)],
    };
  });
}

function extractActionItems(segments: TranscriptSegment[]): StructuredActionItem[] {
  return findMatchingSegments(segments, ["action item", "i'll take that", "will follow up", "by friday", "by next"]).map(({ segment, index }) => ({
    description: segment.text.trim(),
    owner: null,
    dueDate: null,
    evidence: [toEvidence(index, segment)],
  }));
}

function extractStrings(segments: TranscriptSegment[], keywords: string[]): string[] {
  return findMatchingSegments(segments, keywords).map(({ segment }) => segment.text.trim());
}

export const deterministicMinutesGenerator: MeetingMinutesGenerator = {
  id: "deterministic",
  async generate(input: MeetingMinutesGenerationInput): Promise<StructuredMeetingMinutes> {
    const { segments, fullText } = input;
    const speakerLabelMap = input.speakerLabelMap ?? {};

    const attendance = Array.from(new Set(segments.map((segment) => segment.speakerLabel))).map((speakerLabel) => ({
      speakerLabel,
      attendeeName: speakerLabelMap[speakerLabel] ?? null,
    }));

    return {
      meetingTitle: input.meetingTitle,
      meetingDate: input.meetingDate ?? null,
      locationOrFormat: input.locationOrFormat ?? null,
      attendance,
      agendaItems: input.agendaItems ?? [],
      discussionSummaries: fullText
        ? [{ topic: "General discussion", summary: fullText.length > 500 ? `${fullText.slice(0, 500)}...` : fullText, evidence: [] }]
        : [],
      motions: extractMotions(segments),
      decisions: extractStrings(segments, ["approved", "the motion carries", "we agreed"]),
      actionItems: extractActionItems(segments),
      unresolvedIssues: extractStrings(segments, ["table this", "tabled", "revisit", "unresolved", "still need to decide"]),
      nextMeetingDetails: null,
      adjournmentTime: /adjourn/i.test(fullText) ? "mentioned in transcript, exact time not extracted" : null,
      executiveSummary: null,
      status: "draft",
      aiDisclaimer: DETERMINISTIC_FALLBACK_DISCLAIMER,
    };
  },
};
