import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { getProgressionBatchDetail } from "@/lib/labs/pta/student-progression";

/** GET /api/labs/pta/student-progression/:batchId — full batch detail,
 * including every student's planned/applied outcome. */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const { batchId } = await params;
    const batch = await getProgressionBatchDetail(organizationId, batchId);
    return Response.json({ ok: true, data: batch });
  });
}
