import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { getElectionResults } from "@/lib/labs/pta/elections";

/** GET — member results: CERTIFIED elections only, and only for members on
 * that election's voter roll. */
export async function GET(_request: Request, { params }: { params: Promise<{ electionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requirePtaHouseholdSelfAccess();
    const { electionId } = await params;
    const voter = await prisma.ptaElectionVoter.findFirst({
      where: { organizationId, electionId, householdAdultId: adult.id },
      select: { id: true },
    });
    if (!voter) return Response.json({ ok: false, error: "Election not found." }, { status: 404 });
    const results = await getElectionResults(organizationId, electionId, "CERTIFIED");
    return Response.json({ ok: true, data: results });
  });
}
