import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { ensureElectionsEnabled, getElectionResults } from "@/lib/labs/pta/elections";

/** GET — manager results: available once CLOSED (pre-certification review). */
export async function GET(_request: Request, { params }: { params: Promise<{ electionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:elections:view");
    await ensureElectionsEnabled(organizationId);
    const { electionId } = await params;
    const results = await getElectionResults(organizationId, electionId, "CLOSED");
    return Response.json({ ok: true, data: results });
  });
}
