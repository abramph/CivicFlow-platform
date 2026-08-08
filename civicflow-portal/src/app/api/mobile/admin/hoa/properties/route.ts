import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { createProperty, listProperties } from "@/lib/hoa/properties";

const PROPERTY_TYPES = ["SINGLE_FAMILY", "CONDO_UNIT", "TOWNHOME", "VACANT_LOT", "COMMON_PROPERTY", "OTHER"] as const;

const createPropertySchema = z.object({
  organizationId: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  unitLabel: z.string().nullable().optional(),
  buildingLabel: z.string().nullable().optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  displayName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * GET /api/mobile/admin/hoa/properties?organizationId=...&status=...&search=...
 *
 * Mobile Admin program (PR E) — HOA property list. Reuses listProperties()
 * (src/lib/hoa/properties.ts) verbatim, the same function the web
 * /hoa/properties page uses.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_PROPERTIES_READ);

    const status = searchParams.get("status");
    const result = await listProperties(organizationId, {
      status: status === "ACTIVE" || status === "INACTIVE" ? status : undefined,
      search: searchParams.get("search") ?? undefined,
    });

    return Response.json({ ok: true, data: result });
  });
}

/**
 * POST /api/mobile/admin/hoa/properties
 * Delegates to the exact same createProperty() the web /hoa/properties/new
 * form uses.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:properties:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, createPropertySchema);
    const { userId, email } = await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_PROPERTIES_WRITE);

    const property = await createProperty({ organizationId, ...input, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: property }, { status: 201 });
  });
}
