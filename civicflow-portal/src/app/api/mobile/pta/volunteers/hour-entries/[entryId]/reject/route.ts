import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileStaffPermission, requirePtaVerticalForMobile } from "@/lib/mobile-auth";
import { rejectPtaVolunteerHourEntry } from "@/lib/labs/pta/volunteers";
import { PERMISSIONS } from "@/lib/rbac";
import { parseJsonBody } from "@/lib/validation";
import { z } from "zod";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  reason: z.string().trim().min(1).max(1000),
});

/**
 * POST /api/mobile/pta/volunteers/hour-entries/[entryId]/reject
 * Body: { organizationId, reason }
 *
 * Build 27 — the approve route's exact sibling (same guard pair, same
 * service layer), closing the mobile gap where approvals had no reject
 * counterpart and officers fell back to the web for every decline. A reason
 * is required by the service (it lands in the entry's notes and the audit
 * event), PENDING-only finalization and the ledger mirror are enforced in
 * rejectPtaVolunteerHourEntry() itself — nothing is re-implemented here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, reason } = await parseJsonBody(request, bodySchema);

    const { organizationId: verifiedOrgId, session } = await requireMobileStaffPermission(request, organizationId, PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE);
    await requirePtaVerticalForMobile(verifiedOrgId);
    const { entryId } = await params;

    const entry = await rejectPtaVolunteerHourEntry(verifiedOrgId, entryId, reason, session.userId, session.email);
    return Response.json({ ok: true, data: entry });
  });
}
