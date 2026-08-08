import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { addArchitecturalRequestComment } from "@/lib/hoa/architectural-requests";

const commentSchema = z.object({
  organizationId: z.string().min(1),
  body: z.string().min(1).max(3000),
  isPrivate: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ requestId: string }> };

/**
 * POST /api/mobile/admin/hoa/architectural-requests/[requestId]/comments
 * Gated on HOA_ARCHITECTURAL_REQUESTS_REVIEW, matching the web route exactly
 * — NOT READ or WRITE. An officer holding only READ (e.g. READ_ONLY role)
 * can view requests on mobile but will correctly 403 here, same as on web.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:architectural-requests:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { requestId } = await params;
    const { organizationId, body, isPrivate } = await parseJsonBody(request, commentSchema);
    const { userId } = await requireMobileHoaPermission(
      request,
      organizationId,
      "manageHoaArchitecturalRequests",
      PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW
    );

    const comment = await addArchitecturalRequestComment({ organizationId, requestId, body, isPrivate: isPrivate ?? true, actorUserId: userId });
    return Response.json({ ok: true, data: comment }, { status: 201 });
  });
}
