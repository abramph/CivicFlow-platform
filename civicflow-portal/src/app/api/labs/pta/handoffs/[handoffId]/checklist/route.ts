import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { addChecklistItem } from "@/lib/labs/pta/transitions";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).nullable().optional(),
  isRequired: z.boolean().optional(),
});

/** POST /api/labs/pta/handoffs/:id/checklist — add a custom checklist item
 * to a handoff (the position templates are seeded at transition start). */
export async function POST(request: Request, { params }: { params: Promise<{ handoffId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const { handoffId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const item = await addChecklistItem({
      organizationId,
      handoffId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: item }, { status: 201 });
  });
}
