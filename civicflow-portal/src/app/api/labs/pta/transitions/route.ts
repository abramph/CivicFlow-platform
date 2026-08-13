import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createTransition, listTransitions } from "@/lib/labs/pta/transitions";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/transitions — the org's transitions, newest first. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:board:view");
    const transitions = await listTransitions(organizationId);
    return Response.json({ ok: true, data: transitions });
  });
}

const createSchema = z.object({
  fromSchoolYearId: z.string().max(64).nullable().optional(),
  toSchoolYearId: z.string().max(64).nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
});

/** POST — start a transition (defaults: current year → the year after it);
 * seeds a handoff + position-specific checklist per active board position. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const input = await parseJsonBody(request, createSchema);
    const transition = await createTransition({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: transition }, { status: 201 });
  });
}
