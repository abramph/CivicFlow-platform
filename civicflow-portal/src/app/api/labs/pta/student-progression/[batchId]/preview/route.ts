import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { generateProgressionPreview } from "@/lib/labs/pta/student-progression";

/** POST /api/labs/pta/student-progression/:batchId/preview — computes (or
 * refreshes) the full rollover plan as PLANNED records. Writes no
 * PtaStudentEnrollment rows and touches no source-year data — safe to call
 * repeatedly, e.g. after saving a classroom mapping or exception. */
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const { batchId } = await params;
    const batch = await generateProgressionPreview(organizationId, batchId);
    return Response.json({ ok: true, data: batch });
  });
}
