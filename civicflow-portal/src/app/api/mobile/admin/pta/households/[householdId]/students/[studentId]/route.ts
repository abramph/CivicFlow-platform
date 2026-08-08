import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { deactivatePtaStudent } from "@/lib/labs/pta/households";

type RouteParams = { params: Promise<{ householdId: string; studentId: string }> };

/** DELETE /api/mobile/admin/pta/households/[householdId]/students/[studentId]?organizationId=... — soft delete (status INACTIVE), matching the web route; students are never hard-deleted. */
export async function DELETE(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { householdId, studentId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_STUDENTS_MANAGE);

    const student = await deactivatePtaStudent(organizationId, householdId, studentId, userId, email);
    return Response.json({ ok: true, data: student });
  });
}
