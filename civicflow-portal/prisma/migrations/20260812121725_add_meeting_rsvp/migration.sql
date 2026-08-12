-- CreateEnum
CREATE TYPE "MeetingRsvpStatus" AS ENUM ('GOING', 'NOT_GOING', 'MAYBE');

-- CreateTable
CREATE TABLE "MeetingRsvp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "orgMemberId" TEXT NOT NULL,
    "status" "MeetingRsvpStatus" NOT NULL DEFAULT 'GOING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaMeetingRsvp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "attendeeCount" INTEGER NOT NULL DEFAULT 1,
    "status" "PtaRsvpStatus" NOT NULL DEFAULT 'GOING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaMeetingRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingRsvp_organizationId_idx" ON "MeetingRsvp"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingRsvp_meetingId_idx" ON "MeetingRsvp"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingRsvp_orgMemberId_idx" ON "MeetingRsvp"("orgMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRsvp_meetingId_orgMemberId_key" ON "MeetingRsvp"("meetingId", "orgMemberId");

-- CreateIndex
CREATE INDEX "PtaMeetingRsvp_organizationId_idx" ON "PtaMeetingRsvp"("organizationId");

-- CreateIndex
CREATE INDEX "PtaMeetingRsvp_meetingId_idx" ON "PtaMeetingRsvp"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaMeetingRsvp_meetingId_householdId_key" ON "PtaMeetingRsvp"("meetingId", "householdId");

-- AddForeignKey
ALTER TABLE "MeetingRsvp" ADD CONSTRAINT "MeetingRsvp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRsvp" ADD CONSTRAINT "MeetingRsvp_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRsvp" ADD CONSTRAINT "MeetingRsvp_orgMemberId_fkey" FOREIGN KEY ("orgMemberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaMeetingRsvp" ADD CONSTRAINT "PtaMeetingRsvp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaMeetingRsvp" ADD CONSTRAINT "PtaMeetingRsvp_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaMeetingRsvp" ADD CONSTRAINT "PtaMeetingRsvp_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
