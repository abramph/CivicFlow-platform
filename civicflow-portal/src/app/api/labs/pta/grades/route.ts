import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createPtaGrade, listPtaGrades } from "@/lib/labs/pta/academic";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const grades = await listPtaGrades(organizationId);
    return Response.json({ ok: true, data: grades });
  });
}

const bodySchema = z.object({ name: z.string().min(1), sortOrder: z.number().int().optional() });

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:students:manage");
    const input = await parseJsonBody(request, bodySchema);
    const grade = await createPtaGrade(organizationId, input.name, input.sortOrder ?? 0, session.userId, session.userEmail);
    return Response.json({ ok: true, data: grade });
  });
}
