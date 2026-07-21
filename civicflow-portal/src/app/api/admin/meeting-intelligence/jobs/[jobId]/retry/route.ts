import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { createAuditEvent } from "@/lib/audit";
import { getMeetingIntelligenceJobForAdmin } from "@/lib/platform-operations/meeting-intelligence";
import { retryMeetingIntelligenceJob } from "@/lib/labs/meeting-intelligence/jobs";
import { ValidationError } from "@/lib/validation";

/**
 * Platform-admin-scoped retry — distinct from the tenant-facing
 * POST /api/labs/meeting-intelligence/jobs/[jobId]/retry, which requires an
 * organization session. This route is for the Operations Center pilot
 * dashboard: a SUPER_ADMIN can retry any organization's FAILED job without
 * needing a session in that organization.
 *
 * organizationId is never accepted from the client — it is resolved
 * server-side from the job row (getMeetingIntelligenceJobForAdmin, a
 * cross-tenant admin-only lookup), then handed to the same tenant-scoped
 * retryMeetingIntelligenceJob() used by the self-service path, so every
 * guarantee that function already provides (only FAILED can retry, single
 * QUEUED transition, stable audit trail) applies identically here — this
 * route adds no new state-mutation logic of its own, only admin-scoped
 * job resolution and an additional "admin-initiated" audit marker.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:admin:meeting-intelligence:retry",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session } = await requireSuperAdmin("throw");
    const { jobId } = await params;

    const job = await getMeetingIntelligenceJobForAdmin(jobId);
    if (!job) {
      throw new ValidationError("Meeting Intelligence job not found.");
    }

    await createAuditEvent({
      organizationId: job.organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "meeting_intelligence.admin_retry_initiated",
      entityType: "meeting_intelligence_job",
      entityId: job.id,
      metadata: { previousFailureCode: job.failureCode },
    });

    const updated = await retryMeetingIntelligenceJob({
      organizationId: job.organizationId,
      jobId: job.id,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { id: updated.id, status: updated.status } });
  });
}
