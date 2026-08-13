import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createBoardPosition, getBoardRoster } from "@/lib/labs/pta/board";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/board/positions — the roster: active positions with
 * their current holders. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:board:view");
    const roster = await getBoardRoster(organizationId);
    return Response.json({ ok: true, data: roster });
  });
}

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  responsibilities: z.string().max(8000).nullable().optional(),
  classification: z.enum(["OFFICER", "BOARD_MEMBER"]).optional(),
  isVoting: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  termLengthMonths: z.number().int().min(1).max(120).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const input = await parseJsonBody(request, bodySchema);
    const position = await createBoardPosition({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: position }, { status: 201 });
  });
}
