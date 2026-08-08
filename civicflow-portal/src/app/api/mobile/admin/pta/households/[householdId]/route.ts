import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { getPtaHousehold, updatePtaHousehold, deactivatePtaHousehold } from "@/lib/labs/pta/households";

const updateHouseholdSchema = z.object({
  organizationId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]).optional(),
  volunteerInterests: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ householdId: string }> };

/** GET /api/mobile/admin/pta/households/[householdId]?organizationId=... */
export async function GET(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const { householdId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_DIRECTORY_READ);

    const household = await getPtaHousehold(organizationId, householdId);
    return Response.json({ ok: true, data: household });
  });
}

/** PATCH /api/mobile/admin/pta/households/[householdId] */
export async function PATCH(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { householdId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, updateHouseholdSchema);
    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const household = await updatePtaHousehold({ organizationId, householdId, ...input, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: household });
  });
}

/** DELETE /api/mobile/admin/pta/households/[householdId] — soft delete (deactivate) only, matching the web route; hard delete is never exposed. */
export async function DELETE(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { householdId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const household = await deactivatePtaHousehold(organizationId, householdId, userId, email);
    return Response.json({ ok: true, data: household });
  });
}
