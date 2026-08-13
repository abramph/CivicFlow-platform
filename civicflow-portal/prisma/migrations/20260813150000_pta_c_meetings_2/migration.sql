-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingMotionStatus" AS ENUM ('PROPOSED', 'SECONDED', 'PASSED', 'FAILED', 'TABLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ActionItemPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "ActionItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "quorumRequired" INTEGER,
ADD COLUMN     "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
ADD COLUMN     "virtualMeetingUrl" TEXT;

-- CreateTable
CREATE TABLE "MeetingAgendaItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "presenterName" TEXT,
    "durationMinutes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMotion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "moverName" TEXT,
    "seconderName" TEXT,
    "discussionNotes" TEXT,
    "voteMethod" TEXT,
    "votesYes" INTEGER,
    "votesNo" INTEGER,
    "votesAbstain" INTEGER,
    "status" "MeetingMotionStatus" NOT NULL DEFAULT 'PROPOSED',
    "decisionNumber" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingMotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingActionItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT,
    "committeeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" "ActionItemPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "ActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_organizationId_idx" ON "MeetingAgendaItem"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingAgendaItem_meetingId_idx" ON "MeetingAgendaItem"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingMotion_organizationId_idx" ON "MeetingMotion"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingMotion_meetingId_idx" ON "MeetingMotion"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingMotion_organizationId_status_idx" ON "MeetingMotion"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingMotion_organizationId_decisionNumber_key" ON "MeetingMotion"("organizationId", "decisionNumber");

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_idx" ON "MeetingActionItem"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_status_idx" ON "MeetingActionItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_dueDate_idx" ON "MeetingActionItem"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "MeetingActionItem_meetingId_idx" ON "MeetingActionItem"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_committeeId_idx" ON "MeetingActionItem"("committeeId");

-- CreateIndex
CREATE INDEX "Meeting_organizationId_status_idx" ON "Meeting"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMotion" ADD CONSTRAINT "MeetingMotion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMotion" ADD CONSTRAINT "MeetingMotion_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMotion" ADD CONSTRAINT "MeetingMotion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "PtaCommittee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

