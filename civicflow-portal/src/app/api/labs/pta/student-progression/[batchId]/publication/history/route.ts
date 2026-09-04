import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { getProgressionPublicationHistory } from "@/lib/labs/pta/progression-publication";

/** GET — publication audit trail for one batch (publish, idempotent
 * replay, blocked attempt, withdrawal, post-publication correction),
 * newest first. Reads the shared AuditEvent store rather than a parallel
 * history table. Organization scope is verified server-side before any
 * audit row keyed by this batch id is returned. */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const { batchId } = await params;
    const data = await getProgressionPublicationHistory(organizationId, batchId);
    return Response.json({ ok: true, data });
  });
}
