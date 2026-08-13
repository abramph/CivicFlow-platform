import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getPositionHistory, updateBoardPosition } from "@/lib/labs/pta/board";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/board/positions/:id — the position plus its complete
 * leadership history, newest first. */
export async function GET(_request: Request, { params }: { params: Promise<{ positionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:board:view");
    const { positionId } = await params;
    const history = await getPositionHistory(organizationId, positionId);
    return Response.json({ ok: true, data: history });
  });
}

const bodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  responsibilities: z.string().max(8000).nullable().optional(),
  classification: z.enum(["OFFICER", "BOARD_MEMBER"]).optional(),
  isVoting: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  termLengthMonths: z.number().int().min(1).max(120).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ positionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const { positionId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const position = await updateBoardPosition({
      organizationId,
      positionId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: position });
  });
}
