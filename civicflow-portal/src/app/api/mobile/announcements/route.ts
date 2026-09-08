import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { listAnnouncementsForMember } from "@/lib/mobile-announcements";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/announcements?organizationId=...
 * Announcements and organization-wide alerts that were sent to this member,
 * newest first. See mobile-announcements.ts — the query itself is shared
 * with the PTA route (/api/mobile/pta/announcements); only how `memberId`
 * is resolved differs.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);
    // Build 27: the default list excludes the caller's archived items;
    // archived=1 lists exactly those instead. Withdrawn campaigns never
    // appear in either (see mobile-announcements.ts).
    const data = await listAnnouncementsForMember(verifiedOrgId, memberId, { archived: searchParams.get("archived") === "1" });

    return Response.json({ ok: true, data });
  });
}
