import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { cancelPtaVolunteerSignup } from "@/lib/labs/pta/volunteers";
import { ValidationError } from "@/lib/validation";

/**
 * POST /api/mobile/pta/volunteers/slots/[slotId]/cancel
 * Body: { organizationId, reason? }
 * Cancels the CALLER'S OWN signup only. Honors the opportunity's
 * cancellation deadline (PtaError PTA_CANCELLATION_DEADLINE_PASSED, mapped
 * to 409 by withApiErrorHandling) — a parent has no override; only an
 * officer can cancel past the deadline, and only from the web today.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const body = await request.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : null;
    if (!organizationId) throw new ValidationError("organizationId is required");
    const reason = typeof body?.reason === "string" ? body.reason : null;

    const { organizationId: verifiedOrgId, session, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const { slotId } = await params;

    const signup = await cancelPtaVolunteerSignup(verifiedOrgId, slotId, adult.id, session.userId, { reason }, session.email);
    return Response.json({ ok: true, data: signup });
  });
}
