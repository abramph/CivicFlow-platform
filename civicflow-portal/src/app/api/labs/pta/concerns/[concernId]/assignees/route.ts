import { withApiErrorHandling } from "@/lib/api-route";
import { requireConcernAccess } from "@/lib/labs/pta/guard";
import { assignConcernOfficer, removeConcernAssignee } from "@/lib/labs/pta/concerns";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ userId: z.string().min(1).max(64) });

/** POST /api/labs/pta/concerns/:id/assignees — assign an officer to the
 * case. The lib enforces pta:concerns:assign, verifies the assignee is a
 * non-MEMBER active member of this organization, and audits. */
export async function POST(request: Request, { params }: { params: Promise<{ concernId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, viewer } = await requireConcernAccess();
    const { concernId } = await params;
    const { userId } = await parseJsonBody(request, bodySchema);
    const assignee = await assignConcernOfficer({ organizationId, concernId, userId, actor: viewer });
    return Response.json({ ok: true, data: assignee }, { status: 201 });
  });
}

/** DELETE /api/labs/pta/concerns/:id/assignees — remove an assignment. A
 * restricted case always keeps at least one assignee (lib-enforced). */
export async function DELETE(request: Request, { params }: { params: Promise<{ concernId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, viewer } = await requireConcernAccess();
    const { concernId } = await params;
    const { userId } = await parseJsonBody(request, bodySchema);
    await removeConcernAssignee({ organizationId, concernId, userId, actor: viewer });
    return Response.json({ ok: true });
  });
}
