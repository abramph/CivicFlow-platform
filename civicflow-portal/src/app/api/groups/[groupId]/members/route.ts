import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { isGroupLeader, setGroupMembership } from "@/lib/groups";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  memberId: z.string().min(1).max(64),
  action: z.enum(["add", "remove", "make-leader", "remove-leader"]),
});

/** CORE-GIVE-I (§41) — group membership. Two authorization paths:
 *  - org-level groups:members:manage — any group, any action;
 *  - the caller is THIS group's leader (their own OrgGroupMember row,
 *    server-verified) — add/remove only. Leaders never grant or revoke
 *    leadership, and leadership here grants nothing financial. */
export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  return withApiErrorHandling(async () => {
    const { groupId } = await params;
    const { organizationId, session, can } = await requirePermission("groups:view", "throw");
    const input = await parseJsonBody(request, postSchema);

    const hasOrgAuthority = can("groups:members:manage");
    if (!hasOrgAuthority) {
      const leaderOfThisGroup = await isGroupLeader(organizationId, groupId, session.userId);
      const leaderAllowed = leaderOfThisGroup && (input.action === "add" || input.action === "remove");
      if (!leaderAllowed) {
        return Response.json(
          { ok: false, error: "Only this group's leader or a groups administrator can do that." },
          { status: 403 }
        );
      }
    }

    await setGroupMembership({
      organizationId,
      groupId,
      memberId: input.memberId,
      action: input.action,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true });
  });
}
