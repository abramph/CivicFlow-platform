import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { removePtaHouseholdAdult } from "@/lib/labs/pta/households";

type RouteParams = { params: Promise<{ householdId: string; adultId: string }> };

/** DELETE /api/mobile/admin/pta/households/[householdId]/adults/[adultId]?organizationId=... — hard delete, matching the web route (there is no soft-delete/deactivate for an adult). */
export async function DELETE(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { householdId, adultId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    await removePtaHouseholdAdult(organizationId, householdId, adultId, userId, email);
    return Response.json({ ok: true, data: { removed: true } });
  });
}
