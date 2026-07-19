import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { MeetingIntelligenceError } from "./errors";
import type { TranscriptSegment } from "./providers/async-types";

export interface TranscriptView {
  id: string;
  jobId: string;
  provider: string;
  language: string | null;
  speakerCount: number | null;
  durationSeconds: number | null;
  content: string;
  segments: TranscriptSegment[];
  speakerLabelMap: Record<string, string>;
}

function toView(row: {
  id: string;
  jobId: string;
  provider: string;
  language: string | null;
  speakerCount: number | null;
  durationSeconds: number | null;
  content: string;
  segmentsJson: unknown;
  speakerLabelMapJson: unknown;
}): TranscriptView {
  return {
    id: row.id,
    jobId: row.jobId,
    provider: row.provider,
    language: row.language,
    speakerCount: row.speakerCount,
    durationSeconds: row.durationSeconds,
    content: row.content,
    segments: (row.segmentsJson as TranscriptSegment[]) ?? [],
    speakerLabelMap: (row.speakerLabelMapJson as Record<string, string>) ?? {},
  };
}

/** Scoped by organizationId — a jobId from another tenant never resolves. */
export async function getMeetingIntelligenceTranscript(organizationId: string, jobId: string): Promise<TranscriptView | null> {
  const row = await prisma.meetingTranscript.findFirst({ where: { jobId, organizationId } });
  return row ? toView(row) : null;
}

export interface RenameSpeakerLabelsInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
  /** e.g. { "Speaker A": "Alex Chair" } — display-only; the original vendor segments are never rewritten. */
  labelMap: Record<string, string>;
}

/**
 * Renames speaker labels for display only — `segmentsJson` (the original
 * vendor evidence, with its original "Speaker A"/"Speaker B" labels) is
 * never modified. Only `speakerLabelMapJson` (a separate overlay) is
 * written, preserving the transcript's original state for audit purposes.
 * This is a display rename, never a claim that speaker identity has been
 * verified — no biometric identification is implemented anywhere in this
 * feature.
 */
export async function renameMeetingIntelligenceSpeakerLabels(input: RenameSpeakerLabelsInput): Promise<TranscriptView> {
  const row = await prisma.meetingTranscript.findFirst({ where: { jobId: input.jobId, organizationId: input.organizationId } });
  if (!row) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Transcript not found for this job.");

  const validSpeakerLabels = new Set((row.segmentsJson as TranscriptSegment[]).map((segment) => segment.speakerLabel));
  for (const speakerLabel of Object.keys(input.labelMap)) {
    if (!validSpeakerLabels.has(speakerLabel)) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", `Unknown speaker label: ${speakerLabel}`);
    }
  }

  const existingMap = (row.speakerLabelMapJson as Record<string, string>) ?? {};
  const updated = await prisma.meetingTranscript.update({
    where: { id: row.id },
    data: { speakerLabelMapJson: { ...existingMap, ...input.labelMap } },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.speaker_labels_changed",
    entityType: "meeting_intelligence_job",
    entityId: input.jobId,
    // Only the speaker labels being renamed (e.g. "Speaker A") — never the renamed-to name or any transcript content.
    metadata: { renamedLabels: Object.keys(input.labelMap) },
  });

  return toView(updated);
}
