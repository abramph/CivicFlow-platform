import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { createGroup, listGroups } from "@/lib/groups";
import { parseJsonBody, z } from "@/lib/validation";

/** CORE-GIVE-I (§40) — core groups. No module flag here: groups are general
 * organization structure, independent of the giving module. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("groups:view", "throw");
    const groups = await listGroups(organizationId);
    return Response.json({
      ok: true,
      data: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        kindLabel: group.kindLabel,
        status: group.status,
        members: group.members.map((row) => ({
          id: row.member.id,
          name: `${row.member.firstName} ${row.member.lastName}`.trim(),
          isLeader: row.isLeader,
        })),
      })),
    });
  });
}

const postSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  kindLabel: z.string().max(40).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("groups:manage", "throw");
    const input = await parseJsonBody(request, postSchema);
    const group = await createGroup({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { id: group.id, name: group.name } }, { status: 201 });
  });
}
