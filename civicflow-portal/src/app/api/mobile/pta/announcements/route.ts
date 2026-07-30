import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { listAnnouncementsForMember } from "@/lib/mobile-announcements";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/announcements?organizationId=...
 * PTA announcement targeting (resolvePtaTargetMemberIds() in
 * communications.ts, unmodified) always resolves to a household's shared
 * `orgMemberId` — never a per-adult record — so this route resolves the
 * caller's household's billing member id (via requireMobilePtaHouseholdAccess)
 * and reuses the exact same listAnnouncementsForMember() query the
 * conventional-member route uses. A household with no billing identity yet
 * (orgMemberId null — an edge case a brand-new household can be in before
 * an officer finishes setting it up) simply has nothing sent to it yet, so
 * this returns an empty list rather than erroring.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);
    if (!adult.billingMemberId) return Response.json({ ok: true, data: [] });

    const data = await listAnnouncementsForMember(verifiedOrgId, adult.billingMemberId);
    return Response.json({ ok: true, data });
  });
}
