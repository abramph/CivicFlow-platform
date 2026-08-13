import { withApiErrorHandling } from "@/lib/api-route";
import { requireConcernAccess } from "@/lib/labs/pta/guard";
import { addConcernNote } from "@/lib/labs/pta/concerns";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  body: z.string().min(1).max(20000),
  kind: z.enum(["NOTE", "COMMUNICATION", "ACTION"]).optional(),
});

/** POST /api/labs/pta/concerns/:id/notes — append to the case log. The log
 * is append-only by design: no update or delete surface exists. */
export async function POST(request: Request, { params }: { params: Promise<{ concernId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, viewer } = await requireConcernAccess();
    const { concernId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const note = await addConcernNote({ organizationId, concernId, ...input, actor: viewer });
    return Response.json({ ok: true, data: note }, { status: 201 });
  });
}
