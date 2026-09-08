import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { saveProgressionClassroomMappings } from "@/lib/labs/pta/student-progression";
import { parseJsonBody, z } from "@/lib/validation";

const putSchema = z.object({
  mappings: z
    .array(
      z.object({
        sourceClassroomId: z.string().min(1).max(64),
        targetClassroomId: z.string().min(1).max(64),
      })
    )
    .max(500),
});

/** PUT /api/labs/pta/student-progression/:batchId/classroom-mappings —
 * replaces the batch's full source->target classroom mapping set (Section
 * 4 Step 2: "Configure mappings"). Does not itself regenerate the preview
 * — call POST .../preview afterward to see the effect. */
export async function PUT(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const { batchId } = await params;
    const input = await parseJsonBody(request, putSchema);
    const batch = await saveProgressionClassroomMappings({
      organizationId,
      batchId,
      mappings: input.mappings,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: batch });
  });
}
