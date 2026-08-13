import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { updateHandoff } from "@/lib/labs/pta/transitions";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "READY", "ACCEPTED"]).optional(),
  notes: z.string().max(20000).nullable().optional(),
  incomingAssignmentId: z.string().max(64).nullable().optional(),
});

/** PATCH /api/labs/pta/handoffs/:id — notes, incoming officer, status.
 * ACCEPTED requires an incoming officer + all required checklist items. */
export async function PATCH(request: Request, { params }: { params: Promise<{ handoffId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const { handoffId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const handoff = await updateHandoff({
      organizationId,
      handoffId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: handoff });
  });
}
