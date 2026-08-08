import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { getViolationDetail, updateViolationDraft } from "@/lib/hoa/violations";

const updateViolationSchema = z.object({
  organizationId: z.string().min(1),
  violationType: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  cureByDate: z.coerce.date().nullable().optional(),
});

type RouteParams = { params: Promise<{ violationId: string }> };

/** GET /api/mobile/admin/hoa/violations/[violationId]?organizationId=... — includes notices, comments, status history. */
export async function GET(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const { violationId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileHoaPermission(request, organizationId, "manageHoaViolations", PERMISSIONS.HOA_VIOLATIONS_READ);

    const violation = await getViolationDetail(organizationId, violationId);
    return Response.json({ ok: true, data: violation });
  });
}

/** PATCH /api/mobile/admin/hoa/violations/[violationId] — only works while the violation is still DRAFT. */
export async function PATCH(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:violations:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { violationId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, updateViolationSchema);
    await requireMobileHoaPermission(request, organizationId, "manageHoaViolations", PERMISSIONS.HOA_VIOLATIONS_WRITE);

    const violation = await updateViolationDraft({ organizationId, violationId, ...input });
    return Response.json({ ok: true, data: violation });
  });
}
