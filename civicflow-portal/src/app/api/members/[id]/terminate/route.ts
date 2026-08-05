import { requireOrganization } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { MemberLifecycleError } from "@/lib/member-lifecycle-errors";
import { terminateMember } from "@/lib/member-lifecycle";
import { TERMINATION_REASONS } from "@/lib/member-lifecycle-reasons";
import { parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";

const reasonCodes = TERMINATION_REASONS.map((r) => r.value) as [string, ...string[]];

const terminateMemberSchema = z.object({
  reasonCode: z.enum(reasonCodes),
  reasonOther: z.string().trim().max(1000).optional(),
  effectiveDate: z.string().min(1),
  internalNotes: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:terminate",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId, can } = await requireOrganization("throw");
    if (!can("members:terminate")) {
      throw new MemberLifecycleError("INSUFFICIENT_PERMISSION", "You do not have permission to terminate members.");
    }

    const { id } = await params;
    const input = await parseJsonBody(request, terminateMemberSchema);

    const updated = await terminateMember({
      organizationId,
      memberId: id,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      reasonCode: input.reasonCode,
      reasonOther: input.reasonOther,
      effectiveDate: input.effectiveDate,
      internalNotes: input.internalNotes,
    });

    return Response.json({ ok: true, data: updated });
  });
}
