import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { addPtaStudent } from "@/lib/labs/pta/households";

const addStudentSchema = z.object({
  organizationId: z.string().min(1),
  displayName: z.string().min(1),
});

type RouteParams = { params: Promise<{ householdId: string }> };

/**
 * POST /api/mobile/admin/pta/households/[householdId]/students
 * Gated on PTA_STUDENTS_MANAGE — a distinct permission from
 * PTA_HOUSEHOLDS_MANAGE, matching the web route exactly (an officer who
 * can manage households isn't automatically trusted with student records).
 * Deliberately minimal — displayName only, no other fields exist on
 * PtaStudent (see the model's doc comment).
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { householdId } = await params;
    const { organizationId, displayName } = await parseJsonBody(request, addStudentSchema);
    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_STUDENTS_MANAGE);

    const student = await addPtaStudent({ organizationId, householdId, displayName, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: student }, { status: 201 });
  });
}
