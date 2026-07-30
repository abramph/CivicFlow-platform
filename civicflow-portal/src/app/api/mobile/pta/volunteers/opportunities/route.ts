import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { listPtaVolunteerOpportunities } from "@/lib/labs/pta/volunteers";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/volunteers/opportunities?organizationId=...
 * Open volunteer opportunities a parent can browse and claim a shift from.
 * Shaped for the mobile list screen — no officer-only fields (audit ids,
 * manual-assignment actor, etc).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const opportunities = await listPtaVolunteerOpportunities(verifiedOrgId, { status: "OPEN" });

    const data = opportunities.map((opp) => ({
      id: opp.id,
      title: opp.title,
      description: opp.description,
      instructions: opp.instructions,
      signupDeadline: opp.signupDeadline,
      cancellationDeadline: opp.cancellationDeadline,
      slots: opp.slots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        startAt: slot.startAt,
        endAt: slot.endAt,
        locationOverride: slot.locationOverride,
        capacity: slot.capacity,
        claimedCount: slot.claimedCount,
        full: slot.claimedCount >= slot.capacity,
        alreadySignedUp: slot.signups.some((s) => s.householdAdultId === adult.id && s.status !== "CANCELLED"),
      })),
    }));

    return Response.json({ ok: true, data });
  });
}
