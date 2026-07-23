import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createPtaClassroom, listPtaClassrooms } from "@/lib/labs/pta/academic";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const url = new URL(request.url);
    const schoolYear = url.searchParams.get("schoolYear");
    if (!schoolYear) {
      return Response.json({ ok: false, error: "schoolYear query parameter is required" }, { status: 400 });
    }
    const classrooms = await listPtaClassrooms(organizationId, schoolYear);
    return Response.json({ ok: true, data: classrooms });
  });
}

const bodySchema = z.object({ gradeId: z.string().min(1), name: z.string().min(1), schoolYear: z.string().min(1), teacherId: z.string().nullable().optional() });

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:students:manage");
    const input = await parseJsonBody(request, bodySchema);
    const classroom = await createPtaClassroom({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: classroom });
  });
}
