import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { deactivatePtaStudent } from "@/lib/labs/pta/households";

/** Deactivate only — students are never hard-deleted via the API (matches households' soft-delete-first convention). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ householdId: string; studentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:students:manage");
    const { householdId, studentId } = await params;
    const student = await deactivatePtaStudent(organizationId, householdId, studentId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: student });
  });
}
