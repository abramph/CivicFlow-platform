import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { applySuggestedRequirements } from "@/lib/labs/pta/compliance";

/** POST — add the §22 suggested requirements (skips titles already tracked).
 * Deliberately a button, never an automatic seed: no rule is assumed to
 * apply to every PTA/PTO. */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const result = await applySuggestedRequirements({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { created: result.count } });
  });
}
