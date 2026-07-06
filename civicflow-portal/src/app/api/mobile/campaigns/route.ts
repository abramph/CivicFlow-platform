import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/campaigns?organizationId=...
 * Active fundraising campaigns a member can contribute to, for the "Make a
 * Payment" flow — mirrors the member web portal's /m/make-payment query.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobileMembership(request, organizationId);

    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: verifiedOrgId, status: "active" },
      orderBy: { endDate: "asc" },
      select: { id: true, name: true, description: true, goal: true, endDate: true },
      take: 25,
    });

    return Response.json({ ok: true, data: campaigns });
  });
}
