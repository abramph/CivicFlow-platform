import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { updatePropertyResident } from "@/lib/hoa/properties";

const RELATIONSHIP_TYPES = ["OWNER", "CO_OWNER", "RESIDENT", "TENANT", "NON_RESIDENT_OWNER", "OTHER"] as const;

const updateResidentSchema = z.object({
  organizationId: z.string().min(1),
  relationshipType: z.enum(RELATIONSHIP_TYPES).optional(),
  isPrimaryContact: z.boolean().optional(),
  ownershipPercentage: z.number().min(0).max(100).nullable().optional(),
});

type RouteParams = { params: Promise<{ propertyId: string; residentId: string }> };

/** PATCH /api/mobile/admin/hoa/properties/[propertyId]/residents/[residentId] */
export async function PATCH(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:residents:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { residentId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, updateResidentSchema);
    const { userId, email } = await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_RESIDENTS_WRITE);

    const resident = await updatePropertyResident(organizationId, residentId, { ...input, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: resident });
  });
}
