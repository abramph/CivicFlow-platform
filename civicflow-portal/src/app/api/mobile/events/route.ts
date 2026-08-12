import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileOrgAccess } from "@/lib/mobile-auth";
import { buildIndividualRsvpBlock, buildNoRsvpBlock, getRsvpMode } from "@/lib/event-rsvp";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/events?organizationId=...
 * Upcoming organization events, soonest first, each carrying the normalized
 * `rsvp` block (see EventRsvpBlock in src/lib/event-rsvp.ts) — the same
 * contract the PTA events endpoint exposes, so the mobile client consumes one
 * RSVP interface regardless of vertical.
 *
 * Guarded by requireMobileOrgAccess (not requireMobileMembership): viewing
 * events requires only an active tie to the org — a staff-only login sees
 * events like anyone else, with rsvp.canRsvp false because they hold no
 * OrgMember identity to RSVP as. Writing an RSVP (the [eventId]/rsvp route)
 * still requires the full member identity.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileOrgAccess(request, organizationId);

    const organization = await prisma.organization.findUnique({
      where: { id: verifiedOrgId },
      select: { primaryVertical: true },
    });
    const mode = organization ? getRsvpMode(organization.primaryVertical) : "none";
    const includeMyRsvp = mode === "individual" && memberId !== null;

    const events = await prisma.event.findMany({
      where: {
        organizationId: verifiedOrgId,
        OR: [{ endAt: { gte: new Date() } }, { startAt: { gte: new Date() } }],
      },
      orderBy: [{ startAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        startAt: true,
        endAt: true,
        status: true,
        ...(includeMyRsvp
          ? { eventRsvps: { where: { orgMemberId: memberId as string }, select: { status: true } } }
          : {}),
      },
      take: 50,
    });

    const data = events.map((event) => {
      const { eventRsvps, ...rest } = event as typeof event & { eventRsvps?: { status: "GOING" | "NOT_GOING" | "MAYBE" }[] };
      return {
        ...rest,
        rsvp:
          mode === "individual"
            ? buildIndividualRsvpBlock(memberId, includeMyRsvp ? (eventRsvps?.[0] ?? null) : null)
            : // A PTA-vertical org's events fetched through this generic
              // endpoint (a PTA staff/member login with no household link)
              // still reports the org's true mode, with canRsvp false —
              // household RSVP requires the household identity served by the
              // PTA endpoint. HOA (and any future mode-none vertical) reports
              // "none".
              buildNoRsvpBlock(mode),
      };
    });

    return Response.json({ ok: true, data });
  });
}
