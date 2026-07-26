import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { listPtaVolunteerCommitments } from "@/lib/labs/pta/volunteers";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/volunteers/my-commitments?organizationId=...
 * Every past and present commitment for the caller's own household adult —
 * powers "Upcoming assignments" and "Completed service" on the mobile
 * volunteer hub.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const commitments = await listPtaVolunteerCommitments(verifiedOrgId, adult.id);

    const data = commitments.map((c) => ({
      id: c.id,
      status: c.status,
      updatedAt: c.updatedAt,
      opportunityTitle: c.slot.opportunity.title,
      slotLabel: c.slot.label,
      startAt: c.slot.startAt,
      endAt: c.slot.endAt,
    }));

    return Response.json({ ok: true, data });
  });
}
