
-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('MANUAL', 'QR_APP', 'QR_WEB', 'KIOSK');

-- CreateEnum
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceSessionMode" AS ENUM ('ROTATING_QR', 'STATIC_QR');

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "attendanceSessionId" TEXT,
ADD COLUMN     "correctionReason" TEXT,
ADD COLUMN     "method" "AttendanceMethod" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "MeetingAttendanceSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" "AttendanceSessionMode" NOT NULL DEFAULT 'ROTATING_QR',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "lateThresholdMinutes" INTEGER NOT NULL DEFAULT 10,
    "rotationSeconds" INTEGER NOT NULL DEFAULT 30,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "openedByUserId" TEXT,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingAttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingAttendanceSession_organizationId_idx" ON "MeetingAttendanceSession"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingAttendanceSession_meetingId_idx" ON "MeetingAttendanceSession"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingAttendanceSession_status_idx" ON "MeetingAttendanceSession"("status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_attendanceSessionId_idx" ON "AttendanceRecord"("attendanceSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_organizationId_memberId_meetingId_key" ON "AttendanceRecord"("organizationId", "memberId", "meetingId");

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_attendanceSessionId_fkey" FOREIGN KEY ("attendanceSessionId") REFERENCES "MeetingAttendanceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendanceSession" ADD CONSTRAINT "MeetingAttendanceSession_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

