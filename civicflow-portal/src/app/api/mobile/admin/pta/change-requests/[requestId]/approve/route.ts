import { withApiErrorHandling } from "@/lib/api-route";
import { approveFamilyChangeRequest } from "@/lib/labs/pta/family-change-requests";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { PERMISSIONS } from "@/lib/rbac";
import { parseJsonBody, z } from "@/lib/validation";

const decideSchema = z.object({
  organizationId: z.string().min(1),
  decisionNotes: z.union([z.string().trim().max(1000), z.null()]).optional(),
});

/**
 * POST /api/mobile/admin/pta/change-requests/[requestId]/approve
 *
 * Approving APPLIES the change to the real household/student/enrollment
 * records via the same services officers use directly (see
 * family-change-requests.ts) — a CAS claim makes double-approval impossible
 * and an apply failure returns the request to the queue.
 */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:admin:pta:change-requests:decide", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { requestId } = await params;
    const { organizationId, decisionNotes } = await parseJsonBody(request, decideSchema);
    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const applied = await approveFamilyChangeRequest({ organizationId, requestId, decisionNotes: decisionNotes ?? null, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: { id: applied.id, status: applied.status, appliedAt: applied.appliedAt } });
  });
}
