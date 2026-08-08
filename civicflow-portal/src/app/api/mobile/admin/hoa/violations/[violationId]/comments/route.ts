import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { addViolationComment } from "@/lib/hoa/violations";

const commentSchema = z.object({
  organizationId: z.string().min(1),
  body: z.string().min(1).max(3000),
  isPrivate: z.boolean().default(true),
});

type RouteParams = { params: Promise<{ violationId: string }> };

/** POST /api/mobile/admin/hoa/violations/[violationId]/comments — gated on HOA_VIOLATIONS_WRITE, matching the web route (not REVIEW/RESOLVE). */
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
    const { organizationId, body, isPrivate } = await parseJsonBody(request, commentSchema);
    const { userId } = await requireMobileHoaPermission(request, organizationId, "manageHoaViolations", PERMISSIONS.HOA_VIOLATIONS_WRITE);

    const comment = await addViolationComment({ organizationId, violationId, body, isPrivate: isPrivate ?? true, actorUserId: userId });
    return Response.json({ ok: true, data: comment }, { status: 201 });
  });
}
