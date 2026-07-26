import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { checkInPtaVolunteer } from "@/lib/labs/pta/volunteers";

/** Idempotent — see checkInPtaVolunteer()'s own doc comment. Safe to click twice on a spotty event-day connection. */
export async function POST(_request: Request, { params }: { params: Promise<{ signupId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:checkin");
    const { signupId } = await params;
    const attendance = await checkInPtaVolunteer(organizationId, signupId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: attendance });
  });
}
