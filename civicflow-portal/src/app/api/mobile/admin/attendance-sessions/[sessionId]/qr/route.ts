import QRCode from "qrcode";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { getMobileAppWebBaseUrl } from "@/lib/env";
import { signAttendanceToken, currentRotationSlot } from "@/lib/attendance-token";
import { ValidationError } from "@/lib/validation";

/** GET /api/mobile/admin/attendance-sessions/[sessionId]/qr?organizationId=...
 * Mirrors src/app/api/attendance-sessions/[id]/qr/route.ts exactly -- mints
 * the current check-in URL/QR image on demand, nothing persisted per call.
 * The returned qrDataUrl is a data: URI PNG, renderable directly in an
 * Image component -- it's scanned by an attendee's own camera, so nothing
 * about it differs whether the admin is viewing it on web or on this app. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageAttendance")) {
      throw new MobileForbiddenError("No mobile attendance administration access for this organization");
    }
    const { sessionId } = await params;

    const session = await prisma.meetingAttendanceSession.findFirst({ where: { id: sessionId, organizationId } });
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

    const secondsIntoSlot = session.mode === "ROTATING_QR" ? Math.floor(Date.now() / 1000) % session.rotationSeconds : 0;

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
