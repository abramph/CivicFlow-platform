-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('EMAIL', 'SMS', 'PHONE_CALL', 'VOICEMAIL', 'IN_PERSON', 'LETTER', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED', 'LATE', 'VIRTUAL');

-- CreateTable
CREATE TABLE "CommunicationLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "memberId" TEXT,
  "campaignId" TEXT,
  "eventId" TEXT,
  "createdByUserId" TEXT,
  "communicationType" "CommunicationType" NOT NULL,
  "direction" "CommunicationDirection" NOT NULL,
  "subject" TEXT,
  "message" TEXT,
  "outcome" TEXT,
  "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
  "followUpDate" TIMESTAMP(3),
  "communicationDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "eventId" TEXT,
  "meetingTitle" TEXT,
  "meetingDate" TIMESTAMP(3) NOT NULL,
  "attendanceStatus" "AttendanceStatus" NOT NULL,
  "checkInTime" TIMESTAMP(3),
  "checkOutTime" TIMESTAMP(3),
  "notes" TEXT,
  "recordedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationLog_organizationId_idx" ON "CommunicationLog"("organizationId");
CREATE INDEX "CommunicationLog_memberId_idx" ON "CommunicationLog"("memberId");
CREATE INDEX "CommunicationLog_campaignId_idx" ON "CommunicationLog"("campaignId");
CREATE INDEX "CommunicationLog_eventId_idx" ON "CommunicationLog"("eventId");
CREATE INDEX "CommunicationLog_communicationDate_idx" ON "CommunicationLog"("communicationDate");
CREATE INDEX "CommunicationLog_communicationType_idx" ON "CommunicationLog"("communicationType");
CREATE INDEX "CommunicationLog_followUpRequired_idx" ON "CommunicationLog"("followUpRequired");
CREATE INDEX "CommunicationLog_organizationId_followUpRequired_followUpDate_idx" ON "CommunicationLog"("organizationId", "followUpRequired", "followUpDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_organizationId_idx" ON "AttendanceRecord"("organizationId");
CREATE INDEX "AttendanceRecord_memberId_idx" ON "AttendanceRecord"("memberId");
CREATE INDEX "AttendanceRecord_eventId_idx" ON "AttendanceRecord"("eventId");
CREATE INDEX "AttendanceRecord_meetingDate_idx" ON "AttendanceRecord"("meetingDate");
CREATE INDEX "AttendanceRecord_attendanceStatus_idx" ON "AttendanceRecord"("attendanceStatus");

-- AddForeignKey
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
