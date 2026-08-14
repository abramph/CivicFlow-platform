import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { cancelPledge } from "@/lib/giving/pledges";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  organizationId: z.string().min(1),
  action: z.enum(["cancel"]),
});

/** PATCH — member cancels their OWN pledge (ownership lives in the lib
 * query). Cancelling a stated intention never creates anything owed. */
export async function PATCH(request: Request, { params }: { params: Promise<{ pledgeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { pledgeId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const memberSession = await requireMemberWebSession(input.organizationId);
    const pledge = await cancelPledge({
      organizationId: memberSession.organizationId,
      contributorUserId: memberSession.userId,
      pledgeId,
      actorUserId: memberSession.userId,
    });
    return Response.json({ ok: true, data: pledge });
  });
}
