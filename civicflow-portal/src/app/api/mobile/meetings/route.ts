import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileOrgAccess } from "@/lib/mobile-auth";
import { buildIndividualRsvpBlock, buildNoRsvpBlock, getRsvpMode } from "@/lib/event-rsvp";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/meetings?organizationId=...
 * Upcoming meetings, soonest first, each carrying the same normalized `rsvp`
 * block the events endpoints use — one RSVP contract across both surfaces.
 *
 * This is the first member-facing meeting read anywhere in the product (the
 * web meeting list is officer-only, `meetings:read`-gated). The visibility
 * decision is deliberate and mirrors events exactly: the Meeting model has
 * no per-member visibility restriction, so anyone with an active org tie may
 * list upcoming meetings; only the RSVP write requires constituent identity.
 * Officer-only operational fields (notes) are NOT exposed here.
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

    const meetings = await prisma.meeting.findMany({
      where: { organizationId: verifiedOrgId, meetingDate: { gte: new Date() } },
      orderBy: [{ meetingDate: "asc" }],
      select: {
        id: true,
        title: true,
        meetingType: true,
        meetingDate: true,
        location: true,
        description: true,
        ...(includeMyRsvp
          ? { meetingRsvps: { where: { orgMemberId: memberId as string }, select: { status: true } } }
          : {}),
      },
      take: 50,
    });

    const data = meetings.map((meeting) => {
      const { meetingRsvps, ...rest } = meeting as typeof meeting & { meetingRsvps?: { status: "GOING" | "NOT_GOING" | "MAYBE" }[] };
      return {
        ...rest,
        rsvp:
          mode === "individual"
            ? buildIndividualRsvpBlock(memberId, includeMyRsvp ? (meetingRsvps?.[0] ?? null) : null)
            : buildNoRsvpBlock(mode),
      };
    });

    return Response.json({ ok: true, data });
  });
}
