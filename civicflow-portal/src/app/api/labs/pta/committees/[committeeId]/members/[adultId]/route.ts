import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { removePtaCommitteeMember } from "@/lib/labs/pta/committees";

export async function DELETE(_request: Request, { params }: { params: Promise<{ committeeId: string; adultId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:committees:manage");
    const { committeeId, adultId } = await params;
    await removePtaCommitteeMember(organizationId, committeeId, adultId, session.userId, session.userEmail);
    return Response.json({ ok: true });
  });
}
