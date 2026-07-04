import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/events?organizationId=...
 * Upcoming organization events, soonest first.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobileMembership(request, organizationId);

    const events = await prisma.event.findMany({
      where: {
        organizationId: verifiedOrgId,
        OR: [{ endAt: { gte: new Date() } }, { startAt: { gte: new Date() } }],
      },
      orderBy: [{ startAt: "asc" }],
      select: { id: true, title: true, description: true, location: true, startAt: true, endAt: true, status: true },
      take: 50,
    });

    return Response.json({ ok: true, data: events });
  });
}
