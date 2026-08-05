import { requireOrganization } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { MemberLifecycleError } from "@/lib/member-lifecycle-errors";
import { reinstateMember } from "@/lib/member-lifecycle";
import { parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";

const reinstateMemberSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  effectiveDate: z.string().min(1),
  internalNotes: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:reinstate",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId, can } = await requireOrganization("throw");
    if (!can("members:terminate")) {
      throw new MemberLifecycleError("INSUFFICIENT_PERMISSION", "You do not have permission to reinstate members.");
    }

    const { id } = await params;
    const input = await parseJsonBody(request, reinstateMemberSchema);

    const updated = await reinstateMember({
      organizationId,
      memberId: id,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
      internalNotes: input.internalNotes,
    });

    return Response.json({ ok: true, data: updated });
  });
}
