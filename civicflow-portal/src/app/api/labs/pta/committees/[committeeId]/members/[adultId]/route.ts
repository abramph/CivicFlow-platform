import { withApiErrorHandling } from "@/lib/api-route";
import { requireCommitteeManageOrChair } from "@/lib/labs/pta/guard";
import { removePtaCommitteeMember } from "@/lib/labs/pta/committees";

/** PTA-B: same scoped gate as member-add — officer permission or this
 * committee's own chair/co-chair. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ committeeId: string; adultId: string }> }) {
  return withApiErrorHandling(async () => {
    const { committeeId, adultId } = await params;
    const { organizationId, session } = await requireCommitteeManageOrChair(committeeId);
    await removePtaCommitteeMember(organizationId, committeeId, adultId, session.userId, session.userEmail);
    return Response.json({ ok: true });
  });
}
