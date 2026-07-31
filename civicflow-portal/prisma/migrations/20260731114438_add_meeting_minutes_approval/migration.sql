-- CreateEnum
CREATE TYPE "MeetingMinutesStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "MeetingMinutes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "MeetingMinutesStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "lastEditedByUserId" TEXT,
    "lastEditedAt" TIMESTAMP(3),
    "submittedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "changesRequestedByUserId" TEXT,
    "changesRequestedAt" TIMESTAMP(3),
    "changesRequestedReason" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingMinutes_meetingId_version_key" ON "MeetingMinutes"("meetingId", "version");

-- CreateIndex
CREATE INDEX "MeetingMinutes_organizationId_idx" ON "MeetingMinutes"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingMinutes_meetingId_idx" ON "MeetingMinutes"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingMinutes_organizationId_status_idx" ON "MeetingMinutes"("organizationId", "status");

-- AddForeignKey
-- Restrict (not Cascade): approved minutes are a governance/official record;
-- deleting a Meeting or Organization must not silently destroy it. See model
-- comment in schema.prisma.
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_lastEditedByUserId_fkey" FOREIGN KEY ("lastEditedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_changesRequestedByUserId_fkey" FOREIGN KEY ("changesRequestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
