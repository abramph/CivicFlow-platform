import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { reinstateMember } from "@/lib/member-lifecycle";
import { parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";

const reinstateMobileMemberSchema = z.object({
  organizationId: z.string().min(1),
  reason: z.string().trim().min(1).max(1000),
  effectiveDate: z.string().min(1),
  internalNotes: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/mobile/admin/members/[memberId]/reinstate
 * Thin wrapper over the exact same reinstateMember() service the web
 * Reinstate action uses (src/lib/member-lifecycle.ts).
 */
export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:members:reinstate",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, reinstateMobileMemberSchema);
    const { userId, email } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageMembers")) {
      throw new MobileForbiddenError("No mobile member administration access for this organization");
    }

    const { memberId } = await params;

    const updated = await reinstateMember({
      organizationId,
      memberId,
      actorUserId: userId,
      actorEmail: email,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
      internalNotes: input.internalNotes,
    });

    return Response.json({ ok: true, data: updated });
  });
}
