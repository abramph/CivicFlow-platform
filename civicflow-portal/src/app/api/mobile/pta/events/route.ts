import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/events?organizationId=...
 * Events are org-wide reads (the `Event` model has no per-member visibility
 * restriction, unlike Announcements) — the only thing scoped to the
 * caller's own household is their RSVP status, joined in below. Associated
 * volunteer opportunities are included so a parent can jump straight from
 * an event into signing up to help with it.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const events = await prisma.event.findMany({
      where: { organizationId: verifiedOrgId },
      orderBy: [{ startAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startAt: true,
        endAt: true,
        status: true,
        ptaVolunteerOpportunities: { where: { status: { in: ["OPEN", "CLOSED"] } }, select: { id: true, title: true } },
        ptaEventRsvps: { where: { householdId: adult.householdId }, select: { status: true, attendeeCount: true } },
      },
      take: 100,
    });

    const data = events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startAt: event.startAt,
      endAt: event.endAt,
      status: event.status,
      myRsvp: event.ptaEventRsvps[0] ? { status: event.ptaEventRsvps[0].status, attendeeCount: event.ptaEventRsvps[0].attendeeCount } : null,
      volunteerOpportunities: event.ptaVolunteerOpportunities.map((o) => ({ id: o.id, title: o.title })),
    }));

    return Response.json({ ok: true, data });
  });
}
