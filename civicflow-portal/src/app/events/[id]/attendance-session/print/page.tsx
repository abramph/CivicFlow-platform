import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getMobileAppWebBaseUrl } from "@/lib/env";
import { signAttendanceToken } from "@/lib/attendance-token";
import { formatDateTime } from "@/lib/formatting";

/**
 * A printed sheet is inherently static — paper can't rotate a QR code — so
 * this mints one token good for the session's full window (or, for a
 * ROTATING_QR session, effectively just "right now"; printing is really
 * meant to be paired with a STATIC_QR session, called out below). Mirrors
 * the Meeting print page.
 */
export default async function EventAttendancePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("attendance:write");
  const { id } = await params;
  const [event, session, organization] = await Promise.all([
    prisma.event.findFirst({ where: { id, organizationId } }),
    prisma.meetingAttendanceSession.findFirst({ where: { organizationId, eventId: id, status: "OPEN" } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);

  if (!event || !session || !event.startAt) {
    return <div className="p-8 text-center">Attendance isn&apos;t open for this event. Open it first, then reload this page.</div>;
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
  const qrDataUrl = await QRCode.toDataURL(checkInUrl, { errorCorrectionLevel: "M", margin: 2, scale: 10 });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-10 text-center print:p-0">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{organization?.name}</p>
      <h1 className="text-3xl font-bold text-slate-950">{event.title}</h1>
      <p className="text-slate-600">{formatDateTime(event.startAt)}</p>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrDataUrl} alt="Attendance check-in QR code" className="my-6 h-80 w-80" />

      <p className="text-lg text-slate-800">Scan with the Unestra app or your phone camera</p>
      <p className="text-sm text-slate-500">
        Check-in window: {session.opensAt ? formatDateTime(session.opensAt) : "when displayed"}
        {session.closesAt ? ` – ${formatDateTime(session.closesAt)}` : ""}
      </p>
      <p className="max-w-md text-sm font-medium text-amber-700">
        You must sign in to your Unestra account for your scan to record attendance.
      </p>
      {session.mode === "ROTATING_QR" ? (
        <p className="max-w-md text-xs text-slate-500">
          This event uses a rotating code — this printed code is only valid for a short window from when it was
          printed. For a code that stays valid the whole event, use a Static QR session instead.
        </p>
      ) : null}
    </div>
  );
}
