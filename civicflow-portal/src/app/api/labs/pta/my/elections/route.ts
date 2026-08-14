import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { getMyElections } from "@/lib/labs/pta/elections";

/** GET — the member's elections: open ones they may vote in (with ballot
 * contents) and certified ones whose results they may view. Linkage-gated. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requirePtaHouseholdSelfAccess();
    const elections = await getMyElections(organizationId, adult.id);
    return Response.json({ ok: true, data: elections });
  });
}
