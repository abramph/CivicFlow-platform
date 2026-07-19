import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { MeetingIntelligenceError } from "@/lib/labs/meeting-intelligence/errors";
import { FAILURE_HANDLING, type MeetingIntelligenceStage } from "@/lib/labs/meeting-intelligence/state-machine";

/**
 * Status detail for one job — never returns storageObjectKey,
 * transcriptObjectKey, providerJobId, or any raw provider payload (Phase
 * 12: no secrets, internal object keys, signed URLs, or raw provider
 * payloads in the status UI).
 */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMeetingIntelligenceAccess("meetingIntelligence:read");
    const { jobId } = await params;

    const job = await prisma.meetingIntelligenceJob.findFirst({
      where: { id: jobId, organizationId },
      select: {
        id: true,
        meetingId: true,
        status: true,
        provider: true,
        originalFilename: true,
        fileSizeBytes: true,
        audioDurationSeconds: true,
        failureCode: true,
        failureMessage: true,
        createdAt: true,
        submittedAt: true,
        processingStartedAt: true,
        transcribedAt: true,
        minutesGeneratedAt: true,
        completedAt: true,
        failedAt: true,
        cancelledAt: true,
        recordingDeletedAt: true,
        updatedAt: true,
      },
    });
    if (!job) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting Intelligence job not found.");

    const handling = FAILURE_HANDLING[job.status as MeetingIntelligenceStage];
    return Response.json({
      ok: true,
      data: {
        ...job,
        retryAvailable: job.status === "FAILED" && (handling?.retryable ?? false),
        organizationFacingFailureMessage: job.status === "FAILED" ? handling?.organizationFacingMessage ?? job.failureMessage : null,
      },
    });
  });
}
