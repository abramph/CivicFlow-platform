import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { ensureContributionsEnabled } from "@/lib/giving/module";
import { resolveGuestContribution } from "@/lib/giving/public-giving";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  action: z.enum(["link", "dismiss"]),
  memberId: z.string().max(64).nullable().optional(),
});

/** CORE-GIVE-J (§57) — resolve a guest match. The ONLY path that links a
 * guest contribution to a member; data-entry authority, audited. */
export async function POST(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { contributionId } = await params;
    const { organizationId, session } = await requirePermission("contributions:offline:create", "throw");
    await ensureContributionsEnabled(organizationId);
    const input = await parseJsonBody(request, postSchema);
    await resolveGuestContribution({
      organizationId,
      contributionId,
      action: input.action,
      memberId: input.memberId ?? null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true });
  });
}
