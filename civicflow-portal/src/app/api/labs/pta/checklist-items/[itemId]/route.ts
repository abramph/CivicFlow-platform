import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { setChecklistItemCompletion } from "@/lib/labs/pta/transitions";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({ completed: z.boolean() });

/** PATCH /api/labs/pta/checklist-items/:id — check a handoff checklist item
 * off (stamps who/when) or reopen it. */
export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const { itemId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const item = await setChecklistItemCompletion({
      organizationId,
      itemId,
      completed: input.completed,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: item });
  });
}
