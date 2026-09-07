import { withApiErrorHandling } from "@/lib/api-route";
import { PtaError } from "@/lib/labs/pta/errors";
import { MobileForbiddenError, requireMobileMembership, requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import {
  checkInRejectionMessage,
  recordAttendanceCheckIn,
  resolveAttendanceSession,
} from "@/lib/attendance-checkin";

const bodySchema = z.object({
  qrToken: z.string().min(1),
});

/**
 * Resolves which OrgMember this caller's scan checks in, for the org the
 * TOKEN names. Two identities qualify, tried in order:
 *
 *  1. A linked constituent OrgMember (role-agnostic) — the pre-Build-27
 *     behavior, unchanged.
 *  2. Build 27: a PTA household adult with no OrgMember of their own — the
 *     household's shared billing OrgMember is checked in, i.e. household
 *     attendance, exactly the granularity PTA meeting attendance already
 *     uses everywhere else (the billing member IS what PTA targeting,
 *     dues, and announcements resolve to). A second adult of the same
 *     household scanning simply lands on the existing record's
 *     alreadyCheckedIn path.
 *
 * Officer/admin status deliberately does NOT qualify: scanning records
 * attendance for a constituent identity, which an admin-only login doesn't
 * have — minting and session control are their surface instead.
 */
async function resolveCheckInMemberId(request: Request, organizationId: string): Promise<string | null> {
  try {
    const { memberId } = await requireMobileMembership(request, organizationId);
    return memberId;
  } catch (error) {
    if (!(error instanceof MobileForbiddenError)) throw error;
  }
  try {
    const { adult } = await requireMobilePtaHouseholdAccess(request, organizationId);
    return adult.billingMemberId;
  } catch (error) {
    // PtaError covers "this org isn't PTA at all" — for a non-PTA org a
    // caller with no OrgMember is simply not eligible, never a PTA-shaped
    // error. Auth/subscription errors still propagate.
    if (!(error instanceof MobileForbiddenError) && !(error instanceof PtaError)) throw error;
  }
  return null;
}

/**
 * organizationId is deliberately NOT part of the request — it comes only
 * from the scanned token's session (resolveAttendanceSession), so a member
 * with memberships in several organizations always checks in under whichever
 * org the meeting actually belongs to, never whatever org happens to be
 * selected in the app at the time.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "mobile-attendance-check-in",
      request,
      limit: 20,
      windowMs: 5 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const resolved = await resolveAttendanceSession(input.qrToken);
    if (!resolved.ok) {
      return Response.json({ ok: false, error: checkInRejectionMessage(resolved.reason), code: resolved.reason }, { status: 400 });
    }

    const memberId = await resolveCheckInMemberId(request, resolved.session.organizationId);
    if (!memberId) {
      return Response.json({ ok: false, error: checkInRejectionMessage("not_eligible"), code: "not_eligible" }, { status: 403 });
    }

    const member = await prisma.orgMember.findFirst({
      where: { id: memberId, organizationId: resolved.session.organizationId },
      select: { membershipStatus: true },
    });
    if (!member || member.membershipStatus !== "active") {
      return Response.json({ ok: false, error: checkInRejectionMessage("not_eligible"), code: "not_eligible" }, { status: 403 });
    }

    const outcome = await recordAttendanceCheckIn({ session: resolved.session, memberId, method: "QR_APP" });
    return Response.json({ ok: true, data: outcome });
  });
}
