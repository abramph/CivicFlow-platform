import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { issueViolation } from "@/lib/hoa/violations";

const issueSchema = z.object({
  organizationId: z.string().min(1),
  noticeBody: z.string().min(1).max(5000),
  cureByDate: z.coerce.date().nullable().optional(),
});

type RouteParams = { params: Promise<{ violationId: string }> };

/** POST /api/mobile/admin/hoa/violations/[violationId]/issue — the one-time DRAFT->ISSUED transition; also sends the resident's first notice. */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:violations:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { violationId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, issueSchema);
    const { userId } = await requireMobileHoaPermission(request, organizationId, "manageHoaViolations", PERMISSIONS.HOA_VIOLATIONS_WRITE);

    const violation = await issueViolation({ organizationId, violationId, ...input, actorUserId: userId });
    return Response.json({ ok: true, data: violation });
  });
}
