import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { listPtaVolunteerCommitments } from "@/lib/labs/pta/volunteers";

/** Parent self-service — the caller's own commitments only, resolved from their own linked household-adult record. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requirePtaHouseholdSelfAccess();
    const commitments = await listPtaVolunteerCommitments(organizationId, adult.id);
    return Response.json({ ok: true, data: commitments });
  });
}
