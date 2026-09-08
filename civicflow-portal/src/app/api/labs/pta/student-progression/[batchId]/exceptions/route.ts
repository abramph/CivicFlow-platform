import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { saveProgressionException } from "@/lib/labs/pta/student-progression";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  studentId: z.string().min(1).max(64),
  outcome: z.enum(["RETAIN", "TRANSFER", "WITHDRAW", "EXCLUDE", "MANUAL"]),
  targetGradeId: z.string().max(64).nullable().optional(),
  targetClassroomId: z.string().max(64).nullable().optional(),
  exceptionReason: z.string().max(2000).nullable().optional(),
});

/** POST /api/labs/pta/student-progression/:batchId/exceptions — an
 * administrator's per-student override (Section 4 Step 2/3): retain,
 * transfer, withdraw, exclude, or a manual grade/classroom assignment.
 * Only ever writes a non-automatic outcome, so a later preview refresh
 * never clobbers it. */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const { batchId } = await params;
    const input = await parseJsonBody(request, postSchema);
    const record = await saveProgressionException({
      organizationId,
      batchId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: record });
  });
}
