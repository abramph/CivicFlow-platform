import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { getPtaVolunteerOpportunity } from "@/lib/labs/pta/volunteers";
import { ValidationError } from "@/lib/validation";
import { PtaError } from "@/lib/labs/pta/errors";

/**
 * GET /api/mobile/pta/volunteers/opportunities/[opportunityId]?organizationId=...
 * Opportunity detail for the parent shift-signup screen. Deliberately strips
 * every other household's adult names/statuses down to just a headcount —
 * a parent can see how full a shift is, never who else signed up.
 */
export async function GET(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const { opportunityId } = await params;

    const opportunity = await getPtaVolunteerOpportunity(verifiedOrgId, opportunityId);
    if (opportunity.status === "DRAFT" || opportunity.status === "ARCHIVED") {
      throw new PtaError("PTA_OPPORTUNITY_NOT_FOUND", "Volunteer opportunity not found in this organization.");
    }

    const data = {
      id: opportunity.id,
      title: opportunity.title,
      description: opportunity.description,
      instructions: opportunity.instructions,
      status: opportunity.status,
      committee: opportunity.committee?.name ?? null,
      signupDeadline: opportunity.signupDeadline,
      cancellationDeadline: opportunity.cancellationDeadline,
      slots: opportunity.slots.map((slot) => {
        const mine = slot.signups.find((s) => s.householdAdultId === adult.id && s.status !== "CANCELLED");
        return {
          id: slot.id,
          label: slot.label,
          startAt: slot.startAt,
          endAt: slot.endAt,
          locationOverride: slot.locationOverride,
          capacity: slot.capacity,
          claimedCount: slot.claimedCount,
          full: slot.claimedCount >= slot.capacity,
          mySignup: mine ? { id: mine.id, status: mine.status } : null,
        };
      }),
    };

    return Response.json({ ok: true, data });
  });
}
