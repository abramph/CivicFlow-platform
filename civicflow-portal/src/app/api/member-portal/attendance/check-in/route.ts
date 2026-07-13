import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
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
 * Web-session counterpart of /api/mobile/attendance/check-in — same
 * resolve-then-derive-membership flow, just via the NextAuth cookie session
 * (requireMemberWebSession) instead of a mobile bearer token. Organization
 * is still derived only from the token's session, never client input.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "member-portal-attendance-check-in",
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

    const { memberId } = await requireMemberWebSession(resolved.session.organizationId);

    const member = await prisma.orgMember.findFirst({
      where: { id: memberId, organizationId: resolved.session.organizationId },
      select: { membershipStatus: true },
    });
    if (!member || member.membershipStatus !== "active") {
      return Response.json({ ok: false, error: checkInRejectionMessage("not_eligible"), code: "not_eligible" }, { status: 403 });
    }

    const outcome = await recordAttendanceCheckIn({ session: resolved.session, memberId, method: "QR_WEB" });
    return Response.json({ ok: true, data: outcome });
  });
}
