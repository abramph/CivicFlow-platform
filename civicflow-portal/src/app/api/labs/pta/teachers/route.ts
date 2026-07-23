import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createPtaTeacher, listPtaTeachers } from "@/lib/labs/pta/academic";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const teachers = await listPtaTeachers(organizationId);
    return Response.json({ ok: true, data: teachers });
  });
}

const bodySchema = z.object({ name: z.string().min(1), email: z.string().nullable().optional() });

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:students:manage");
    const input = await parseJsonBody(request, bodySchema);
    const teacher = await createPtaTeacher(organizationId, input.name, input.email, session.userId, session.userEmail);
    return Response.json({ ok: true, data: teacher });
  });
}
