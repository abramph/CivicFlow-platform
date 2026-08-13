import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { setMeetingStatus } from "@/lib/meeting-operations";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ status: z.enum(["DRAFT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) });

/** PTA-C: meeting lifecycle transitions (validated server-side; COMPLETED is
 * terminal). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const meeting = await setMeetingStatus({
      organizationId,
      meetingId: id,
      status: input.status,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: meeting });
  });
}
