import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { setHouseholdMembership } from "@/lib/giving/households";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  memberId: z.string().min(1).max(64),
  action: z.enum(["add", "remove"]),
});

/** CORE-GIVE-H — add/remove a member from a household. Org-scoped inside
 * the lib; both directions audited. */
export async function POST(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { householdId } = await params;
    const { organizationId, session } = await requirePermission("members:write", "throw");
    const input = await parseJsonBody(request, postSchema);
    await setHouseholdMembership({
      organizationId,
      householdId,
      memberId: input.memberId,
      action: input.action,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true });
  });
}
