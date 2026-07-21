import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { deleteMeetingRecordingObject, RECORDING_RETENTION_DAYS } from "./storage";
import { isTerminalStage } from "./state-machine";

/**
 * Meeting Intelligence MVP — automatic retention cleanup (Phase 16).
 *
 * Deletes only the source recording object once it is older than
 * RECORDING_RETENTION_DAYS (30) days past creation — never the transcript,
 * never a MeetingMinutesDraft row, and never an APPROVED draft (which is
 * an official record). This job only ever nulls
 * `MeetingIntelligenceJob.storageObjectKey` and sets `recordingDeletedAt`;
 * it has no code path that touches `MeetingMinutesDraft` at all, so a
 * cleanup pass can never silently delete official minutes.
 *
 * Only processes jobs already in a settled state (terminal, or otherwise
 * done being actively worked — DRAFT_READY/IN_REVIEW/APPROVED/FAILED/
 * CANCELLED) so an in-flight job's recording is never removed out from
 * under the worker mid-processing.
 */

export const SETTLED_STAGES = ["DRAFT_READY", "IN_REVIEW", "APPROVED", "FAILED", "CANCELLED"] as const;

export async function runMeetingIntelligenceRetentionCleanup(limit = 100): Promise<{ scanned: number; deleted: number; failed: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECORDING_RETENTION_DAYS);

  const jobs = await prisma.meetingIntelligenceJob.findMany({
    where: {
      status: { in: [...SETTLED_STAGES] },
      storageObjectKey: { not: null },
      createdAt: { lt: cutoff },
    },
    take: limit,
  });

  let deleted = 0;
  let failed = 0;
  for (const job of jobs) {
    if (!job.storageObjectKey) continue;
    if (isTerminalStage(job.status as never)) continue; // already DELETED — shouldn't match the query, but double-guarded

    // Each job is isolated: a single Spaces failure (transient network error,
    // outage) must not abort the whole batch and block every job ordered
    // after it in this tick — it just retries on the next scheduled run.
    try {
      await deleteMeetingRecordingObject(job.storageObjectKey);
      await prisma.meetingIntelligenceJob.update({
        where: { id: job.id },
        data: { storageObjectKey: null, recordingDeletedAt: new Date() },
      });

      await createAuditEvent({
        organizationId: job.organizationId,
        actorUserId: null,
        actorEmail: "system@retention-cleanup",
        action: "meeting_intelligence.recording_deleted",
        entityType: "meeting_intelligence_job",
        entityId: job.id,
        metadata: { reason: "retention_policy", retentionDays: RECORDING_RETENTION_DAYS },
      });
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.error(`[meeting-intelligence-retention] failed to delete recording for job ${job.id}`, error);
    }
  }

  return { scanned: jobs.length, deleted, failed };
}
