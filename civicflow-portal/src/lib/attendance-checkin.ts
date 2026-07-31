/**
 * Unestra SaaS — Shared meeting/event-attendance QR check-in core.
 *
 * Both the mobile app (bearer-token auth) and the web fallback
 * (/attendance/check-in, NextAuth cookie session) funnel through this same
 * module so the actual attendance-recording logic — idempotency, the
 * PRESENT/LATE cutoff, audit trail, notification — exists exactly once. A
 * MeetingAttendanceSession is backed by exactly one of meetingId/eventId
 * (enforced by a DB check constraint — see schema.prisma), so every function
 * here branches on whichever is set rather than assuming meetingId.
 * Each caller is responsible for its own authentication and for deriving
 * memberId from organizationId the way its guard system already does
 * (requireMobileMembership / requireMemberWebSession) — this module never
 * trusts a caller-supplied memberId without that having already happened.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { sendPushToMember } from "@/lib/push";
import { unsafeDecodeSessionId, verifyAttendanceToken, type AttendanceTokenRejection } from "@/lib/attendance-token";

export type CheckInRejectionReason =
  | AttendanceTokenRejection
  | "not_found"
  | "not_eligible";

const REJECTION_MESSAGES: Record<CheckInRejectionReason, string> = {
  invalid: "This code isn't valid. Ask the meeting host for a fresh QR code.",
  expired: "This code has expired. Scan the current QR code shown at the meeting.",
  session_not_found: "This code isn't valid. Ask the meeting host for a fresh QR code.",
  session_not_open: "Attendance isn't currently open for this meeting.",
  outside_window: "Check-in isn't open yet, or has already closed, for this meeting.",
  stale_version: "This code was replaced with a new one. Scan the current QR code shown at the meeting.",
  future_slot: "This code isn't valid yet. Scan the current QR code shown at the meeting.",
  slot_too_old: "This code has expired. Scan the current QR code shown at the meeting.",
  not_found: "This meeting or event is no longer available.",
  not_eligible: "You're not eligible to check into this meeting.",
};

export function checkInRejectionMessage(reason: CheckInRejectionReason): string {
  return REJECTION_MESSAGES[reason];
}

export interface ResolvedAttendanceSession {
  id: string;
  organizationId: string;
  meetingId: string | null;
  eventId: string | null;
  meetingTitle: string;
  meetingDate: Date;
  lateThresholdMinutes: number;
}

export type ResolveSessionResult =
  | { ok: true; session: ResolvedAttendanceSession }
  | { ok: false; reason: CheckInRejectionReason };

/**
 * Decodes + verifies a scanned QR token and loads the MeetingAttendanceSession
 * it refers to, fresh from the database (never cached) so status/tokenVersion
 * checks are always against current state. Returns the organizationId a
 * caller must then verify the authenticated user actually belongs to — this
 * function does no authentication or authorization itself.
 */
export async function resolveAttendanceSession(qrToken: string): Promise<ResolveSessionResult> {
  const sessionId = unsafeDecodeSessionId(qrToken);
  if (!sessionId) return { ok: false, reason: "invalid" };

  const session = await prisma.meetingAttendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      meeting: { select: { id: true, title: true, meetingDate: true } },
      event: { select: { id: true, title: true, startAt: true } },
    },
  });
  if (!session) return { ok: false, reason: "session_not_found" };

  const verified = await verifyAttendanceToken(qrToken, session);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  // Exactly one of meeting/event is set, by the DB check constraint. An
  // event's startAt is nullable in general, but session creation requires it
  // to be set before a QR session can be opened for that event — this null
  // check only ever trips if that invariant were somehow violated.
  const contextTitle = session.meeting?.title ?? session.event?.title;
  const contextDate = session.meeting?.meetingDate ?? session.event?.startAt;
  if (!contextTitle || !contextDate) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    session: {
      id: session.id,
      organizationId: session.organizationId,
      meetingId: session.meetingId,
      eventId: session.eventId,
      meetingTitle: contextTitle,
      meetingDate: contextDate,
      lateThresholdMinutes: session.lateThresholdMinutes,
    },
  };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export interface CheckInOutcome {
  alreadyCheckedIn: boolean;
  attendanceRecordId: string;
  attendanceStatus: "PRESENT" | "LATE";
  checkInTime: Date;
  meetingTitle: string;
  meetingDate: Date;
  organizationId: string;
}

/**
 * Records the check-in. Idempotent: if a record already exists for this
 * (organizationId, memberId, meetingId-or-eventId) — whether from an earlier
 * valid scan, a concurrent duplicate request, or prior manual entry —
 * returns that existing record's confirmation instead of erroring or
 * creating a second row. PRESENT vs LATE is computed here, server-side, from
 * the meeting/event's scheduled start and the session's grace period — never
 * from anything the scanning device reports about its own clock.
 */
export async function recordAttendanceCheckIn(params: {
  session: ResolvedAttendanceSession;
  memberId: string;
  method: "QR_APP" | "QR_WEB";
}): Promise<CheckInOutcome> {
  const { session, memberId, method } = params;
  const now = new Date();
  const lateCutoff = new Date(session.meetingDate.getTime() + session.lateThresholdMinutes * 60_000);
  const status: "PRESENT" | "LATE" = now > lateCutoff ? "LATE" : "PRESENT";

  try {
    const created = await prisma.attendanceRecord.create({
      data: {
        organizationId: session.organizationId,
        memberId,
        meetingId: session.meetingId,
        eventId: session.eventId,
        meetingTitle: session.meetingTitle,
        meetingDate: session.meetingDate,
        attendanceStatus: status,
        checkInTime: now,
        method,
        attendanceSessionId: session.id,
      },
    });

    await createAuditEvent({
      organizationId: session.organizationId,
      action: "check_in",
      entityType: "attendance_record",
      entityId: created.id,
      metadata: { memberId, meetingId: session.meetingId, eventId: session.eventId, method, attendanceStatus: status },
    });

    // Best-effort — a notification failure must never fail the check-in itself.
    sendPushToMember({
      organizationId: session.organizationId,
      memberId,
      title: "Checked in",
      body: `You're checked in to ${session.meetingTitle}${status === "LATE" ? " (marked late)" : ""}.`,
    }).catch(() => null);

    return {
      alreadyCheckedIn: false,
      attendanceRecordId: created.id,
      attendanceStatus: status,
      checkInTime: now,
      meetingTitle: session.meetingTitle,
      meetingDate: session.meetingDate,
      organizationId: session.organizationId,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    // Concurrent or repeat scan — the unique constraint is the actual source
    // of truth for "only one record", this just fetches it back. Branches on
    // whichever FK the session is backed by, since AttendanceRecord has an
    // independent unique index for each.
    const existing = session.meetingId
      ? await prisma.attendanceRecord.findUnique({
          where: {
            organizationId_memberId_meetingId: { organizationId: session.organizationId, memberId, meetingId: session.meetingId },
          },
        })
      : await prisma.attendanceRecord.findUnique({
          where: {
            organizationId_memberId_eventId: { organizationId: session.organizationId, memberId, eventId: session.eventId as string },
          },
        });
    if (!existing) throw error; // genuinely unexpected — surface the original error

    return {
      alreadyCheckedIn: true,
      attendanceRecordId: existing.id,
      attendanceStatus: existing.attendanceStatus === "LATE" ? "LATE" : "PRESENT",
      checkInTime: existing.checkInTime ?? existing.createdAt,
      meetingTitle: session.meetingTitle,
      meetingDate: session.meetingDate,
      organizationId: session.organizationId,
    };
  }
}
