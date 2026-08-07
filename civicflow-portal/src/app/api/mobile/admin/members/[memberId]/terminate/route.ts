import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { terminateMember } from "@/lib/member-lifecycle";
import { TERMINATION_REASONS } from "@/lib/member-lifecycle-reasons";
import { parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";

const reasonCodes = TERMINATION_REASONS.map((r) => r.value) as [string, ...string[]];

const terminateMobileMemberSchema = z.object({
  organizationId: z.string().min(1),
  reasonCode: z.enum(reasonCodes),
  reasonOther: z.string().trim().max(1000).optional(),
  effectiveDate: z.string().min(1),
  internalNotes: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/mobile/admin/members/[memberId]/terminate
 * Thin wrapper over the exact same terminateMember() service the web
 * Terminate action uses (src/lib/member-lifecycle.ts) — never a raw
 * membershipStatus write. This is the only status action PR B exposes on
 * mobile: it's the only one with a last-active-owner protection, reason
 * codes, and effective-date validation already built and tested; the
 * generic deactivate/suspend/retire PATCH path has no equivalent
 * last-owner check today and was deliberately left off mobile for PR B.
 */
export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:members:terminate",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, terminateMobileMemberSchema);
    const { userId, email } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageMembers")) {
      throw new MobileForbiddenError("No mobile member administration access for this organization");
    }

    const { memberId } = await params;

    const updated = await terminateMember({
      organizationId,
      memberId,
      actorUserId: userId,
      actorEmail: email,
      reasonCode: input.reasonCode,
      reasonOther: input.reasonOther,
      effectiveDate: input.effectiveDate,
      internalNotes: input.internalNotes,
    });

    return Response.json({ ok: true, data: updated });
  });
}
