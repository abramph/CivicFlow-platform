import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { enrollPtaStudent } from "@/lib/labs/pta/academic";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ classroomId: z.string().min(1), schoolYear: z.string().min(1) });

/** Idempotent — re-enrolling a student in the same school year updates the existing enrollment row rather than duplicating it (see enrollPtaStudent's upsert). This is also how school-year rollover works: pass the new year's classroom id. */
export async function POST(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:students:manage");
    const { studentId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const enrollment = await enrollPtaStudent(organizationId, studentId, input.classroomId, input.schoolYear, session.userId, session.userEmail);
    return Response.json({ ok: true, data: enrollment });
  });
}
