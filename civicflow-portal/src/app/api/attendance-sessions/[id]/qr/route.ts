import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { getMobileAppWebBaseUrl } from "@/lib/env";
import { signAttendanceToken, currentRotationSlot } from "@/lib/attendance-token";

/**
 * Mints the *current* check-in URL/QR image for a session — nothing about
 * this is persisted (no new database row per call, per rotation or per
 * request); it's regenerated on demand from the session's live status and
 * tokenVersion. The admin UI polls this on an interval matching
 * rotationSeconds to keep the displayed code current.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("attendance:write", "throw");
    const { id } = await params;

    const session = await prisma.meetingAttendanceSession.findFirst({ where: { id, organizationId } });
    if (!session) return Response.json({ ok: false, error: "Attendance session not found" }, { status: 404 });
    if (session.status !== "OPEN") {
      return Response.json({ ok: false, error: "Attendance isn't open — open it first to display a QR code." }, { status: 400 });
    }

    const token = await signAttendanceToken({
      sessionId: session.id,
      organizationId: session.organizationId,
      meetingId: session.meetingId,
      eventId: session.eventId,
      tokenVersion: session.tokenVersion,
      mode: session.mode,
      rotationSeconds: session.rotationSeconds,
    });
    const checkInUrl = `${getMobileAppWebBaseUrl()}/attendance/check-in?token=${encodeURIComponent(token)}`;
    const qrDataUrl = await QRCode.toDataURL(checkInUrl, { errorCorrectionLevel: "M", margin: 2, scale: 8 });

    const secondsIntoSlot =
      session.mode === "ROTATING_QR"
        ? Math.floor(Date.now() / 1000) % session.rotationSeconds
        : 0;

    return Response.json({
      ok: true,
      data: {
        checkInUrl,
        qrDataUrl,
        mode: session.mode,
        rotationSeconds: session.rotationSeconds,
        secondsRemainingInSlot: session.mode === "ROTATING_QR" ? session.rotationSeconds - secondsIntoSlot : null,
        slot: session.mode === "ROTATING_QR" ? currentRotationSlot(session.rotationSeconds) : null,
      },
    });
  });
}
