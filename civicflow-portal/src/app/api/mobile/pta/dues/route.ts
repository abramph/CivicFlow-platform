import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { getPtaParentDuesSummary } from "@/lib/labs/pta/parent-dues";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/dues?organizationId=...
 * Mobile bridge for the caller's own household dues summary — identical
 * data shape and business logic to the web's
 * `GET /api/labs/pta/my-household/dues` (parent-dues.ts, unmodified). Real
 * charge statuses only (NO_CHARGE/UNPAID/PARTIALLY_PAID/PAID/WAIVED/
 * VOIDED/PENDING_REVIEW) — never a fabricated "refunded" status.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, adult } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const summary = await getPtaParentDuesSummary(verifiedOrgId, adult.householdId);
    return Response.json({ ok: true, data: summary });
  });
}
