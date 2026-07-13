import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
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

    const { memberId } = await requireMobileMembership(request, resolved.session.organizationId);

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
