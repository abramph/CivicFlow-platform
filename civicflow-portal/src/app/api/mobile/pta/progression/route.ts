import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { getPtaParentProgressionSummary } from "@/lib/labs/pta/parent-progression";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/progression?organizationId=...
 *
 * Read-only, family-scoped student progression for the caller's OWN
 * household. Mirrors the shape of the sibling mobile PTA bridges
 * (`/api/mobile/pta/dues`, `/api/mobile/pta/household/photo`): authenticate
 * first, resolve the household strictly from the caller's own
 * `PtaHouseholdAdult` linkage, never from anything the client sends.
 *
 * There is deliberately **no** POST/PATCH/DELETE here and no administrative
 * counterpart is reused: preview, classroom mapping, commit, correction,
 * exclusion, rollback and audit remain portal-only, behind
 * `requirePtaAccess` + the progression permissions. This route reads only
 * committed enrollment data (see parent-progression.ts).
 *
 * `requireMobilePtaHouseholdAccess` enforces, in order: bearer
 * authentication, PTA vertical + active organization
 * (`requirePtaVerticalForMobile`), the caller's own active household
 * linkage, and organization access. The service then additionally enforces
 * the two progression feature flags, both of which default OFF.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const summary = await getPtaParentProgressionSummary(verifiedOrgId, adult.householdId);
    return Response.json({ ok: true, data: summary });
  });
}
