import { withApiErrorHandling } from "@/lib/api-route";
import { rejectFamilyChangeRequest } from "@/lib/labs/pta/family-change-requests";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { PERMISSIONS } from "@/lib/rbac";
import { parseJsonBody, z } from "@/lib/validation";

const decideSchema = z.object({
  organizationId: z.string().min(1),
  decisionNotes: z.union([z.string().trim().max(1000), z.null()]).optional(),
});

/** POST /api/mobile/admin/pta/change-requests/[requestId]/reject — CAS
 * transition SUBMITTED → REJECTED; nothing is ever applied. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:admin:pta:change-requests:decide", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { requestId } = await params;
    const { organizationId, decisionNotes } = await parseJsonBody(request, decideSchema);
    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const rejected = await rejectFamilyChangeRequest({ organizationId, requestId, decisionNotes: decisionNotes ?? null, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: { id: rejected?.id, status: rejected?.status } });
  });
}
