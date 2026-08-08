import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { getProperty, updateProperty } from "@/lib/hoa/properties";

const PROPERTY_TYPES = ["SINGLE_FAMILY", "CONDO_UNIT", "TOWNHOME", "VACANT_LOT", "COMMON_PROPERTY", "OTHER"] as const;

const updatePropertySchema = z.object({
  organizationId: z.string().min(1),
  addressLine1: z.string().min(1).optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  unitLabel: z.string().nullable().optional(),
  buildingLabel: z.string().nullable().optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  displayName: z.string().nullable().optional(),
  billingMemberId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ propertyId: string }> };

/** GET /api/mobile/admin/hoa/properties/[propertyId]?organizationId=... — includes residents (active + ended). */
export async function GET(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const { propertyId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_PROPERTIES_READ);

    const property = await getProperty(organizationId, propertyId);
    return Response.json({ ok: true, data: property });
  });
}

/** PATCH /api/mobile/admin/hoa/properties/[propertyId] */
export async function PATCH(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:properties:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { propertyId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, updatePropertySchema);
    const { userId, email } = await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_PROPERTIES_WRITE);

    const property = await updateProperty(organizationId, propertyId, { ...input, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: property });
  });
}
