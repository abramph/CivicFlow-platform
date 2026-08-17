import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { submitMemberSelfServiceUpdate } from "@/lib/member-intake/self-service";
import { ALLOWED_MEMBER_TARGET_FIELDS, type AllowedMemberTargetField } from "@/lib/member-intake/sensitivity";

/**
 * GET /api/mobile/profile?organizationId=...
 * The caller's own member profile + communication preferences — the mobile
 * equivalent of the staff-facing member edit form's "SMS Preferences" /
 * comms toggles, scoped strictly to the authenticated member's own record.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const member = await prisma.orgMember.findFirst({
      where: { id: memberId, organizationId: verifiedOrgId },
      select: {
        firstName: true,
        lastName: true,
        preferredName: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zipCode: true,
        commsPushEnabled: true,
        commsEmailEnabled: true,
        commsSmsEnabled: true,
        smsOptedOutAt: true,
      },
    });
    if (!member) {
      return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: member });
  });
}

const bodySchema = z.object({
  organizationId: z.string().min(1),
  commsPushEnabled: z.boolean().optional(),
  commsEmailEnabled: z.boolean().optional(),
  commsSmsEnabled: z.boolean().optional(),
});

/**
 * PATCH /api/mobile/profile
 * Lets a member toggle their own push/email/SMS opt-in. smsOptedOutAt is
 * deliberately not accepted here — same rule as the staff edit form: only a
 * real carrier-level STOP/START reply can set or clear it, never a toggle.
 */
export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, bodySchema);
    const { memberId } = await requireMobileMembership(request, input.organizationId);

    const updated = await prisma.orgMember.update({
      where: { id: memberId },
      data: {
        ...(input.commsPushEnabled !== undefined ? { commsPushEnabled: input.commsPushEnabled } : {}),
        ...(input.commsEmailEnabled !== undefined ? { commsEmailEnabled: input.commsEmailEnabled } : {}),
        ...(input.commsSmsEnabled !== undefined ? { commsSmsEnabled: input.commsSmsEnabled } : {}),
      },
      select: {
        commsPushEnabled: true,
        commsEmailEnabled: true,
        commsSmsEnabled: true,
        smsOptedOutAt: true,
      },
    });

    return Response.json({ ok: true, data: updated });
  });
}

const SELF_SERVICE_TARGET_FIELDS = ALLOWED_MEMBER_TARGET_FIELDS.filter(
  (f): f is Exclude<AllowedMemberTargetField, "commsPushEnabled" | "commsEmailEnabled" | "commsSmsEnabled"> =>
    !["commsPushEnabled", "commsEmailEnabled", "commsSmsEnabled"].includes(f)
);

const selfServiceBodySchema = z.object({
  organizationId: z.string().min(1),
  fieldValues: z.record(z.enum(SELF_SERVICE_TARGET_FIELDS as [string, ...string[]]), z.unknown()),
});

/**
 * POST /api/mobile/profile
 *
 * MEMBER-QR-J — "Profile → Update My Information." Unlike PATCH above (which
 * writes comms toggles directly), this is a SUBMISSION, not a direct write:
 * it goes through the same Member Intake apply engine the public QR form
 * uses (§23/§32), so a HIGH-sensitivity change (legal name, email, date of
 * birth) still routes to the admin review queue instead of auto-applying
 * just because the caller has a valid session.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:profile:self-service", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, selfServiceBodySchema);
    const { session, organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, input.organizationId);

    const result = await submitMemberSelfServiceUpdate(verifiedOrgId, memberId, { userId: session.userId, userEmail: session.email }, input.fieldValues);
    return Response.json({ ok: true, data: result });
  });
}
