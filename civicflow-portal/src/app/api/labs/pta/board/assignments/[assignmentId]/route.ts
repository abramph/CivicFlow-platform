import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { activateOfficerAssignment, endOfficerAssignment } from "@/lib/labs/pta/board";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  action: z.enum(["end", "activate"]),
  effectiveDate: z.coerce.date().nullable().optional(),
});

/** PATCH /api/labs/pta/board/assignments/:id — lifecycle actions only.
 * There is deliberately no edit-in-place or delete: assignments are an
 * append-only governance record. */
export async function PATCH(request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const { assignmentId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const common = {
      organizationId,
      assignmentId,
      endDate: input.effectiveDate ?? null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    };
    const assignment = input.action === "end" ? await endOfficerAssignment(common) : await activateOfficerAssignment(common);
    return Response.json({ ok: true, data: assignment });
  });
}
