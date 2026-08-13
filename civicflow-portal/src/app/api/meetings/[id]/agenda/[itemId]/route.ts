import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { removeAgendaItem } from "@/lib/meeting-operations";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { itemId } = await params;
    await removeAgendaItem({ organizationId, agendaItemId: itemId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true });
  });
}
