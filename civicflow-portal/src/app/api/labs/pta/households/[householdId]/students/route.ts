import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { addPtaStudent } from "@/lib/labs/pta/households";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ displayName: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:students:manage");
    const { householdId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const student = await addPtaStudent({ organizationId, householdId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: student });
  });
}
