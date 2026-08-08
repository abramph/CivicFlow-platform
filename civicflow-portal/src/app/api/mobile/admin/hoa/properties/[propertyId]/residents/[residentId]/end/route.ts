import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { endPropertyResidentRelationship } from "@/lib/hoa/properties";

const endResidentSchema = z.object({
  organizationId: z.string().min(1),
  moveOutDate: z.coerce.date().nullable().optional(),
});

type RouteParams = { params: Promise<{ propertyId: string; residentId: string }> };

/** POST /api/mobile/admin/hoa/properties/[propertyId]/residents/[residentId]/end — defaults moveOutDate to now if omitted. */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:residents:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { residentId } = await params;
    const { organizationId, moveOutDate } = await parseJsonBody(request, endResidentSchema);
    const { userId, email } = await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_RESIDENTS_WRITE);

    const resident = await endPropertyResidentRelationship(organizationId, residentId, { moveOutDate, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: resident });
  });
}
