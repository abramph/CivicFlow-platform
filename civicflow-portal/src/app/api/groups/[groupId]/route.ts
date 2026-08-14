import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { updateGroup } from "@/lib/groups";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  kindLabel: z.string().min(1).max(40).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

/** CORE-GIVE-I — rename/relabel/archive a group. Org-level authority only:
 * a group leader cannot rename or archive their own group (§41 scope is
 * membership, nothing structural). */
export async function PATCH(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  return withApiErrorHandling(async () => {
    const { groupId } = await params;
    const { organizationId, session } = await requirePermission("groups:manage", "throw");
    const input = await parseJsonBody(request, patchSchema);
    const group = await updateGroup({
      organizationId,
      groupId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { id: group.id, status: group.status } });
  });
}
