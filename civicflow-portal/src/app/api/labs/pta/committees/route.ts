import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createPtaCommittee, listPtaCommittees } from "@/lib/labs/pta/committees";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const committees = await listPtaCommittees(organizationId);
    return Response.json({ ok: true, data: committees });
  });
}

const bodySchema = z.object({ name: z.string().min(1), description: z.string().nullable().optional() });

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:committees:manage");
    const input = await parseJsonBody(request, bodySchema);
    const committee = await createPtaCommittee(organizationId, input.name, input.description, session.userId, session.userEmail);
    return Response.json({ ok: true, data: committee });
  });
}
