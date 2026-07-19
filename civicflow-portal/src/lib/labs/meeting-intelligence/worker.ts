import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { transitionJob } from "./state-machine";
import { getMeetingTranscriptionProvider } from "./providers/async-index";
import { getSignedRecordingUrl, buildMeetingIntelligenceTranscriptObjectKey, uploadMeetingTranscriptArtifact } from "./storage";
import { generateMeetingMinutes } from "./minutes";
import { createMeetingMinutesDraft } from "./minutes-review";
import { recordAudioMinutesTranscribed, recordAudioMinutesUploaded, recordMinutesGenerationJob, recordTranscriptionJob } from "./usage";
import { estimateGenerationCostCents, estimateTranscriptionCostCents } from "./cost-constants";
import { MeetingIntelligenceError } from "./errors";

/**
 * Meeting Intelligence MVP — background worker. Reuses the platform's
 * existing cron/worker convention (see src/workers/campaigns.ts +
 * src/app/api/cron/campaigns/route.ts) — no new queue infrastructure.
 *
 * Enrollment-disabled-mid-flight policy (Phase 5, documented per the
 * task's explicit ask):
 *   - A QUEUED job whose organization is no longer Labs-entitled/enrolled
 *     is never submitted to the provider — it fails immediately with
 *     MEETING_INTELLIGENCE_ENROLLMENT_DISABLED.
 *   - A job already SUBMITTED_TO_PROVIDER/TRANSCRIBING is allowed to
 *     finish retrieving its transcript — the vendor is already processing
 *     it, and the transcript itself is a completion of already-committed
 *     work, not a new output.
 *   - Minutes generation (a genuinely new AI-processing step) is re-gated:
 *     if enrollment has been disabled by the time the transcript is ready,
 *     the job stops at TRANSCRIBED (failed with
 *     MEETING_INTELLIGENCE_ENROLLMENT_DISABLED) rather than generating a
 *     new draft. The transcript itself is preserved for audit/deletion.
 */

const BATCH_LIMIT = 25;

// If a claim is older than this and the job is still QUEUED, the worker that
// claimed it is assumed to have crashed or been killed mid-submission (e.g.
// a deploy restart) — the claim is treated as abandoned and becomes
// reclaimable. Well above the AssemblyAI submit call's own realistic
// duration so a merely-slow-but-alive worker is never preempted.
const CLAIM_STALE_AFTER_MS = 10 * 60_000;

/**
 * Atomically claims a QUEUED job for submission — a conditional UPDATE
 * (WHERE status = QUEUED AND (claimedAt IS NULL OR claimedAt < staleThreshold))
 * that only one concurrent invocation of processQueuedMeetingIntelligenceJobs
 * can win. This repo's cron endpoints are triggered by an external scheduler
 * (see DEPLOYMENT.md) with no guarantee against overlapping invocations, so
 * without this, two overlapping ticks could both read the same QUEUED job
 * and both submit it to AssemblyAI — a real, billable duplicate vendor
 * submission, not just a data race. Returns false if another invocation won
 * the claim (not an error — the caller should just skip the job).
 */
async function claimQueuedJob(jobId: string): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  const result = await prisma.meetingIntelligenceJob.updateMany({
    where: {
      id: jobId,
      status: "QUEUED",
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleThreshold } }],
    },
    data: { claimedAt: new Date() },
  });
  return result.count === 1;
}

async function organizationLabsActive(organizationId: string): Promise<boolean> {
  const access = await getOrganizationLabAccess(organizationId, "meetingIntelligence");
  return access.available;
}

async function failJob(jobId: string, organizationId: string, code: string, message: string) {
  await transitionJob({ jobId, organizationId, to: "FAILED", failureCode: code, failureMessage: message });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Picks up QUEUED jobs, rechecks org/enrollment, submits to the provider, advances to TRANSCRIBING. */
export async function processQueuedMeetingIntelligenceJobs(limit = BATCH_LIMIT): Promise<{ processed: number; submitted: number; failed: number }> {
  const jobs = await prisma.meetingIntelligenceJob.findMany({ where: { status: "QUEUED" }, take: limit, orderBy: { createdAt: "asc" } });

  let submitted = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      if (!(await claimQueuedJob(job.id))) {
        // Lost the claim race to another concurrent invocation (or the job
        // moved on already) — not a failure, just skip it this tick.
        continue;
      }
      if (!(await organizationLabsActive(job.organizationId))) {
        await failJob(job.id, job.organizationId, "MEETING_INTELLIGENCE_ENROLLMENT_DISABLED", "Labs enrollment was disabled before this job could be submitted for processing.");
        failed += 1;
        continue;
      }
      if (!job.storageObjectKey) {
        await failJob(job.id, job.organizationId, "MEETING_INTELLIGENCE_STORAGE_OBJECT_MISSING", "The recording is missing from storage.");
        failed += 1;
        continue;
      }

      const signedUrl = await getSignedRecordingUrl(job.storageObjectKey, 3600);
      const provider = getMeetingTranscriptionProvider(job.provider);
      const submission = await provider.submit({
        organizationId: job.organizationId,
        jobId: job.id,
        meetingId: job.meetingId,
        audioUrl: signedUrl,
      });

      await transitionJob({
        jobId: job.id,
        organizationId: job.organizationId,
        to: "SUBMITTED_TO_PROVIDER",
        extraData: { providerJobId: submission.externalJobId },
      });
      await transitionJob({ jobId: job.id, organizationId: job.organizationId, to: "TRANSCRIBING" });
      await recordTranscriptionJob(job.organizationId, job.id, job.provider);
      submitted += 1;
    } catch (error) {
      const code = error instanceof MeetingIntelligenceError ? error.code : "MEETING_INTELLIGENCE_PROVIDER_UNAVAILABLE";
      const message = error instanceof Error ? error.message : "Unable to submit the recording for transcription.";
      await failJob(job.id, job.organizationId, code, message);
      failed += 1;
    }
  }

  return { processed: jobs.length, submitted, failed };
}

/** Polls TRANSCRIBING jobs for completion; on success, stores the transcript, then (re-gated) proceeds to minutes generation. */
export async function pollTranscribingMeetingIntelligenceJobs(limit = BATCH_LIMIT): Promise<{ processed: number; completed: number; failed: number }> {
  const jobs = await prisma.meetingIntelligenceJob.findMany({ where: { status: "TRANSCRIBING" }, take: limit, orderBy: { createdAt: "asc" } });

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    if (!job.providerJobId) {
      await failJob(job.id, job.organizationId, "MEETING_INTELLIGENCE_INVALID_PROVIDER_RESPONSE", "No provider job id recorded for this job.");
      failed += 1;
      continue;
    }

    try {
      const provider = getMeetingTranscriptionProvider(job.provider);
      const status = await provider.getStatus(job.providerJobId);

      if (status.status === "error") {
        await failJob(job.id, job.organizationId, "MEETING_INTELLIGENCE_TRANSCRIPTION_FAILED", status.errorMessage ?? "Transcription failed.");
        failed += 1;
        continue;
      }
      if (status.status !== "completed" || !status.result) {
        continue; // still queued/processing at the vendor — re-poll next tick
      }

      const { result } = status;
      const durationMinutes = result.durationMs / 60_000;

      // Duplicate-prevention: a retry that re-observes this job already
      // having a transcript row must not create a second one.
      const existingTranscript = await prisma.meetingTranscript.findUnique({ where: { jobId: job.id } });
      let transcriptRow = existingTranscript;
      if (!transcriptRow) {
        const transcriptKey = buildMeetingIntelligenceTranscriptObjectKey(job.organizationId, job.meetingId, job.id);
        await uploadMeetingTranscriptArtifact({ key: transcriptKey, buffer: Buffer.from(JSON.stringify(result)) });

        try {
          transcriptRow = await prisma.meetingTranscript.create({
            data: {
              organizationId: job.organizationId,
              meetingId: job.meetingId,
              jobId: job.id,
              provider: job.provider,
              language: result.language,
              speakerCount: result.speakerCount,
              durationSeconds: Math.round(result.durationMs / 1000),
              content: result.fullText,
              segmentsJson: result.segments as never,
            },
          });
        } catch (createError) {
          // A concurrent overlapping poll already created this transcript
          // (MeetingTranscript.jobId is unique) between our existence check
          // above and this insert — not a real failure, just lost a race.
          // Adopt the row the other invocation created instead of failing
          // the job over a duplicate-detection race.
          if (!isUniqueConstraintError(createError)) throw createError;
          transcriptRow = await prisma.meetingTranscript.findUniqueOrThrow({ where: { jobId: job.id } });
        }

        await transitionJob({
          jobId: job.id,
          organizationId: job.organizationId,
          to: "TRANSCRIBED",
          extraData: { audioDurationSeconds: Math.round(result.durationMs / 1000), transcriptObjectKey: transcriptKey },
        });
        // Recorded here (not at upload time) because the real duration is
        // only known once the provider reports it — no bytes-to-minutes
        // estimate is ever fabricated for usage metering.
        await recordAudioMinutesUploaded(job.organizationId, job.id, durationMinutes);
        await recordAudioMinutesTranscribed(job.organizationId, job.id, durationMinutes, job.provider, estimateTranscriptionCostCents(durationMinutes));
      }

      // Re-gate before the *new* AI-processing step — a transcript that
      // already completed is preserved either way (see module doc above).
      if (!(await organizationLabsActive(job.organizationId))) {
        await failJob(job.id, job.organizationId, "MEETING_INTELLIGENCE_ENROLLMENT_DISABLED", "Labs enrollment was disabled before minutes could be generated. The transcript has been preserved.");
        failed += 1;
        continue;
      }

      const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: job.meetingId } });
      await transitionJob({ jobId: job.id, organizationId: job.organizationId, to: "GENERATING_MINUTES" });

      const { result: minutesResult, generatorId } = await generateMeetingMinutes({
        meetingTitle: meeting.title,
        meetingDate: meeting.meetingDate?.toISOString() ?? null,
        segments: result.segments,
        fullText: result.fullText,
      });

      await createMeetingMinutesDraft({ organizationId: job.organizationId, jobId: job.id, content: minutesResult, generatorId });
      await transitionJob({ jobId: job.id, organizationId: job.organizationId, to: "DRAFT_READY" });
      await recordMinutesGenerationJob(job.organizationId, job.id, generatorId, estimateGenerationCostCents());

      completed += 1;
    } catch (error) {
      const code = error instanceof MeetingIntelligenceError ? error.code : "MEETING_INTELLIGENCE_GENERATION_FAILED";
      const message = error instanceof Error ? error.message : "Processing failed.";
      await failJob(job.id, job.organizationId, code, message);
      failed += 1;
    }
  }

  return { processed: jobs.length, completed, failed };
}

export async function processMeetingIntelligenceQueue() {
  const submission = await processQueuedMeetingIntelligenceJobs();
  const polling = await pollTranscribingMeetingIntelligenceJobs();
  return { submission, polling };
}
