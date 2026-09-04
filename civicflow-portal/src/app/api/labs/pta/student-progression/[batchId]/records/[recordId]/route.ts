import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { correctProgressionRecord } from "@/lib/labs/pta/student-progression";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  outcome: z.enum(["PROMOTE", "RETAIN", "GRADUATE", "TRANSFER", "WITHDRAW", "EXCLUDE", "MANUAL", "NEEDS_REVIEW"]),
  targetGradeId: z.string().max(64).nullable().optional(),
  targetClassroomId: z.string().max(64).nullable().optional(),
  exceptionReason: z.string().max(2000).nullable().optional(),
});

/** PATCH /api/labs/pta/student-progression/:batchId/records/:recordId —
 * Section 4 Step 5's safe correction path: adjusts ONE student's outcome
 * after commit without reopening or affecting any other record. Same
 * higher-risk permission tier as commit/rollback. */
export async function PATCH(request: Request, { params }: { params: Promise<{ batchId: string; recordId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_COMMIT);
    const { batchId, recordId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const record = await correctProgressionRecord({
      organizationId,
      batchId,
      recordId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: record });
  });
}
