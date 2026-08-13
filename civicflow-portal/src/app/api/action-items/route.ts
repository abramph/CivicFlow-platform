import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createActionItem, listOpenActionItems } from "@/lib/meeting-operations";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("meetings:read", "throw");
    const items = await listOpenActionItems(organizationId);
    return Response.json({ ok: true, data: items });
  });
}

const bodySchema = z.object({
  meetingId: z.string().nullable().optional(),
  committeeId: z.string().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  ownerName: z.string().max(200).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const input = await parseJsonBody(request, bodySchema);
    const item = await createActionItem({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: item }, { status: 201 });
  });
}
