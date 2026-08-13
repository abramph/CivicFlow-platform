import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { updateActionItem } from "@/lib/meeting-operations";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(4000).nullable().optional(),
  ownerName: z.string().max(200).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ actionItemId: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { actionItemId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const item = await updateActionItem({
      organizationId,
      actionItemId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: item });
  });
}
