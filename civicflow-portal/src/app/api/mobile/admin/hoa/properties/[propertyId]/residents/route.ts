import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { assignPropertyResident, getPropertyResidentHistory, listActivePropertyResidents } from "@/lib/hoa/properties";

const RELATIONSHIP_TYPES = ["OWNER", "CO_OWNER", "RESIDENT", "TENANT", "NON_RESIDENT_OWNER", "OTHER"] as const;

const assignResidentSchema = z.object({
  organizationId: z.string().min(1),
  orgMemberId: z.string().min(1),
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  isPrimaryContact: z.boolean().optional(),
  ownershipPercentage: z.number().min(0).max(100).nullable().optional(),
  moveInDate: z.coerce.date().nullable().optional(),
});

type RouteParams = { params: Promise<{ propertyId: string }> };

/** GET /api/mobile/admin/hoa/properties/[propertyId]/residents?organizationId=...&history=true */
export async function GET(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const { propertyId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_RESIDENTS_READ);

    const residents =
      searchParams.get("history") === "true"
        ? await getPropertyResidentHistory(organizationId, propertyId)
        : await listActivePropertyResidents(organizationId, propertyId);

    return Response.json({ ok: true, data: residents });
  });
}

/** POST /api/mobile/admin/hoa/properties/[propertyId]/residents — assign a resident relationship. */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:residents:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { propertyId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, assignResidentSchema);
    const { userId, email } = await requireMobileHoaPermission(request, organizationId, "manageHoaProperties", PERMISSIONS.HOA_RESIDENTS_WRITE);

    const resident = await assignPropertyResident({ organizationId, propertyId, ...input, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: resident }, { status: 201 });
  });
}
