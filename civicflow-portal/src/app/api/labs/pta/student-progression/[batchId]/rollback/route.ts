import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { rollbackProgressionBatch } from "@/lib/labs/pta/student-progression";

/** POST /api/labs/pta/student-progression/:batchId/rollback — reverts a
 * committed batch's target-year enrollments to INACTIVE and returns its
 * records to PLANNED. Blocked (409) if any affected household has
 * volunteer-ledger activity recorded since the commit — see
 * rollbackProgressionBatch's own doc comment for the exact scope of that
 * check. Same higher-risk permission tier as commit. */
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_COMMIT);
    const { batchId } = await params;
    const batch = await rollbackProgressionBatch({ organizationId, batchId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: batch });
  });
}
