import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { claimPtaVolunteerSlot } from "@/lib/labs/pta/volunteers";
import { ValidationError } from "@/lib/validation";

/**
 * POST /api/mobile/pta/volunteers/slots/[slotId]/claim
 * Body: { organizationId }
 * Claims a seat for the CALLER'S OWN household-adult record only —
 * householdAdultId is never accepted from the client. Mirrors the web
 * route (src/app/api/labs/pta/volunteers/slots/[slotId]/claim/route.ts)
 * exactly — same atomic/concurrency-safe library function, no duplicated
 * capacity logic.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const body = await request.json().catch(() => ({}));
    const organizationId = typeof body?.organizationId === "string" ? body.organizationId : null;
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, session, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const { slotId } = await params;

    const signup = await claimPtaVolunteerSlot(verifiedOrgId, slotId, adult.id, session.userId, session.email);
    return Response.json({ ok: true, data: signup });
  });
}
