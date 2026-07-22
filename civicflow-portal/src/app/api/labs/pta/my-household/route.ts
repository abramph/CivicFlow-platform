import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { getPtaHousehold } from "@/lib/labs/pta/households";

/**
 * Parent self-service — returns ONLY the caller's own household, never a
 * directory. requirePtaHouseholdSelfAccess() resolves the household from the
 * caller's own linked PtaHouseholdAdult.userId, never from a client-supplied
 * householdId, so there is no parameter here for a parent to substitute
 * another household's id into.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requirePtaHouseholdSelfAccess();
    const household = await getPtaHousehold(organizationId, adult.householdId);
    return Response.json({ ok: true, data: household });
  });
}
