-- AlterTable: MeetingAttendanceSession.meetingId becomes optional and gains a
-- sibling eventId, so a session can be backed by either a Meeting or an
-- Event. The existing meetingId FK (added in
-- 20260713120207_meeting_attendance_qr_sessions) already tolerates NULLs
-- once the column itself is nullable, so it needs no changes.
ALTER TABLE "MeetingAttendanceSession" ALTER COLUMN "meetingId" DROP NOT NULL;
ALTER TABLE "MeetingAttendanceSession" ADD COLUMN     "eventId" TEXT;

-- CreateIndex
CREATE INDEX "MeetingAttendanceSession_eventId_idx" ON "MeetingAttendanceSession"("eventId");

-- AddForeignKey
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraint: exactly one of meetingId/eventId must be set, enforced at
-- the DB level rather than only by application code — a session can never
-- silently end up backed by neither (or both).
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_meeting_xor_event_check" CHECK (
  (("meetingId" IS NOT NULL)::int + ("eventId" IS NOT NULL)::int) = 1
);

-- CreateIndex: same duplicate-prevention AttendanceRecord already has for
-- (organizationId, memberId, meetingId), mirrored for eventId so event-backed
-- QR check-ins are idempotent at the DB level too.
CREATE UNIQUE INDEX "AttendanceRecord_organizationId_memberId_eventId_key" ON "AttendanceRecord"("organizationId", "memberId", "eventId");
