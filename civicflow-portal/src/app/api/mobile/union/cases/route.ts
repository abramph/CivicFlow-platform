import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { listMyUnionCasesForMobileMember } from "@/lib/union/cases-guard";
import { toMemberSafeUnionCase } from "@/lib/union/cases";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/union/cases?organizationId=...
 * Native counterpart to /api/union/cases/my (which requires a NextAuth web
 * session the mobile app's bearer-token client can never hold) -- every
 * case the caller has ever submitted, in the active organization.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const cases = await listMyUnionCasesForMobileMember(verifiedOrgId, memberId);
    return Response.json({ ok: true, data: cases.map(toMemberSafeUnionCase) });
  });
}
