import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { archiveProperty } from "@/lib/hoa/properties";

const bodySchema = z.object({ organizationId: z.string().min(1) });

type RouteParams = { params: Promise<{ propertyId: string }> };

/** POST /api/mobile/admin/hoa/properties/[propertyId]/archive — idempotent if already archived. */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:properties:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { propertyId } = await params;
    const { organizationId } = await parseJsonBody(request, bodySchema);
    if (!organizationId) throw new ValidationError("organizationId is required");
    const { userId, email } = await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_PROPERTIES_WRITE);

    const property = await archiveProperty(organizationId, propertyId, { actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: property });
  });
}
