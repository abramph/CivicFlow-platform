import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { ensureElectionsEnabled, getElectionDetail, setElectionStatus } from "@/lib/labs/pta/elections";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ electionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:elections:view");
    await ensureElectionsEnabled(organizationId);
    const { electionId } = await params;
    const election = await getElectionDetail(organizationId, electionId);
    return Response.json({ ok: true, data: election });
  });
}

const patchSchema = z.object({
  status: z.enum(["DRAFT", "NOMINATIONS", "VOTING", "CLOSED", "CERTIFIED", "CANCELLED"]),
});

/** PATCH — lifecycle moves. →VOTING takes the eligibility snapshot;
 * CERTIFIED stamps the certifier. */
export async function PATCH(request: Request, { params }: { params: Promise<{ electionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:elections:manage");
    await ensureElectionsEnabled(organizationId);
    const { electionId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const election = await setElectionStatus({
      organizationId,
      electionId,
      status: input.status,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: election });
  });
}
