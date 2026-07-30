import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { getPtaParentDuesSummary } from "@/lib/labs/pta/parent-dues";

/** Parent self-service — the caller's own household's dues summary only. Household id is never accepted from the client; resolved server-side by requirePtaHouseholdSelfAccess(). */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requirePtaHouseholdSelfAccess();
    const summary = await getPtaParentDuesSummary(organizationId, adult.householdId);
    return Response.json({ ok: true, data: summary });
  });
}
