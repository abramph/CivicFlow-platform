import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { ValidationError } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { getArchitecturalRequestDetail } from "@/lib/hoa/architectural-requests";

type RouteParams = { params: Promise<{ requestId: string }> };

/** GET /api/mobile/admin/hoa/architectural-requests/[requestId]?organizationId=... — read only, see route.ts's doc comment. */
export async function GET(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const { requestId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileHoaPermission(request, organizationId, "manageHoaArchitecturalRequests", PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ);

    const detail = await getArchitecturalRequestDetail(organizationId, requestId);
    return Response.json({ ok: true, data: detail });
  });
}
