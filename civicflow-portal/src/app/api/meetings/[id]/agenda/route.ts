import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { addAgendaItem } from "@/lib/meeting-operations";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  presenterName: z.string().max(200).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const item = await addAgendaItem({
      organizationId,
      meetingId: id,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: item }, { status: 201 });
  });
}
