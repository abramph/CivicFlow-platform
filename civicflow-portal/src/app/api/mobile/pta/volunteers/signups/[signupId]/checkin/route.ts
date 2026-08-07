import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileStaffPermission, requirePtaVerticalForMobile } from "@/lib/mobile-auth";
import { checkInPtaVolunteer } from "@/lib/labs/pta/volunteers";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";

/**
 * POST /api/mobile/pta/volunteers/signups/[signupId]/checkin
 * Body: { organizationId }
 * Idempotent, server-timestamped — a duplicate tap on a spotty event-day
 * connection returns the existing checkInAt rather than overwriting it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ signupId: string }> }) {
  return withApiErrorHandling(async () => {
    const body = await request.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : null;
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, session } = await requireMobileStaffPermission(request, organizationId, PERMISSIONS.PTA_VOLUNTEERS_CHECKIN);
    await requirePtaVerticalForMobile(verifiedOrgId);
    const { signupId } = await params;

    const attendance = await checkInPtaVolunteer(verifiedOrgId, signupId, session.userId, session.email);
    return Response.json({ ok: true, data: attendance });
  });
}
