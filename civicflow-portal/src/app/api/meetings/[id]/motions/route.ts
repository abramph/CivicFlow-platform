import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { recordMotion } from "@/lib/meeting-operations";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  text: z.string().min(1).max(4000),
  moverName: z.string().max(200).nullable().optional(),
  seconderName: z.string().max(200).nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const motion = await recordMotion({
      organizationId,
      meetingId: id,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: motion }, { status: 201 });
  });
}
