import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { computeReadiness, getOrgReadinessFacts, getTransitionDetail, updateTransition } from "@/lib/labs/pta/transitions";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/transitions/:id — full detail plus the computed
 * readiness report (§12's "78% — completed / missing"). */
export async function GET(_request: Request, { params }: { params: Promise<{ transitionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:board:view");
    const { transitionId } = await params;
    const transition = await getTransitionDetail(organizationId, transitionId);
    const readiness = computeReadiness(transition, await getOrgReadinessFacts(organizationId));
    return Response.json({ ok: true, data: { transition, readiness } });
  });
}

const patchSchema = z.object({
  status: z.enum(["PREPARING", "READY_FOR_HANDOFF", "HANDOFF_IN_PROGRESS", "ACCEPTED", "COMPLETED"]).optional(),
  notes: z.string().max(8000).nullable().optional(),
});

/** PATCH — status moves and notes. COMPLETED is the guarded ceremony: every
 * handoff accepted → incoming officers activated → school year flipped. */
export async function PATCH(request: Request, { params }: { params: Promise<{ transitionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const { transitionId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const transition = await updateTransition({
      organizationId,
      transitionId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: transition });
  });
}
