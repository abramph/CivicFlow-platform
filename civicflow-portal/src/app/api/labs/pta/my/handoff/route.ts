import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { getMyIncomingHandoff, acceptOwnHandoff } from "@/lib/labs/pta/transitions";

/** GET /api/labs/pta/my/handoff — the signed-in incoming officer's own
 * handoff (null when they aren't one). Linkage-gated, never a Permission. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaHouseholdSelfAccess();
    const handoff = await getMyIncomingHandoff(organizationId, session.userId);
    return Response.json({ ok: true, data: handoff });
  });
}

/** POST — §15 step 9: accept your own position. Requires every required
 * checklist item complete (same rule as the board-manager path). */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaHouseholdSelfAccess();
    const handoff = await acceptOwnHandoff({ organizationId, userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: handoff });
  });
}
