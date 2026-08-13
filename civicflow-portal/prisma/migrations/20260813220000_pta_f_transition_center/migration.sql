-- CreateEnum
CREATE TYPE "PtaTransitionStatus" AS ENUM ('PREPARING', 'READY_FOR_HANDOFF', 'HANDOFF_IN_PROGRESS', 'ACCEPTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PtaHandoffStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY', 'ACCEPTED');

-- CreateTable
CREATE TABLE "PtaBoardTransition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromSchoolYearId" TEXT NOT NULL,
    "toSchoolYearId" TEXT NOT NULL,
    "status" "PtaTransitionStatus" NOT NULL DEFAULT 'PREPARING',
    "notes" TEXT,
    "startedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaBoardTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaOfficerHandoff" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transitionId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "outgoingAssignmentId" TEXT,
    "incomingAssignmentId" TEXT,
    "status" "PtaHandoffStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "notes" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaOfficerHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaHandoffChecklistItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaHandoffChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaBoardTransition_organizationId_idx" ON "PtaBoardTransition"("organizationId");

-- CreateIndex
CREATE INDEX "PtaBoardTransition_organizationId_status_idx" ON "PtaBoardTransition"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PtaBoardTransition_organizationId_fromSchoolYearId_toSchool_key" ON "PtaBoardTransition"("organizationId", "fromSchoolYearId", "toSchoolYearId");

-- CreateIndex
CREATE INDEX "PtaOfficerHandoff_organizationId_idx" ON "PtaOfficerHandoff"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaOfficerHandoff_transitionId_positionId_key" ON "PtaOfficerHandoff"("transitionId", "positionId");

-- CreateIndex
CREATE INDEX "PtaHandoffChecklistItem_organizationId_idx" ON "PtaHandoffChecklistItem"("organizationId");

-- CreateIndex
CREATE INDEX "PtaHandoffChecklistItem_handoffId_idx" ON "PtaHandoffChecklistItem"("handoffId");

-- AddForeignKey
ALTER TABLE "PtaBoardTransition" ADD CONSTRAINT "PtaBoardTransition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBoardTransition" ADD CONSTRAINT "PtaBoardTransition_fromSchoolYearId_fkey" FOREIGN KEY ("fromSchoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBoardTransition" ADD CONSTRAINT "PtaBoardTransition_toSchoolYearId_fkey" FOREIGN KEY ("toSchoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBoardTransition" ADD CONSTRAINT "PtaBoardTransition_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerHandoff" ADD CONSTRAINT "PtaOfficerHandoff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerHandoff" ADD CONSTRAINT "PtaOfficerHandoff_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "PtaBoardTransition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerHandoff" ADD CONSTRAINT "PtaOfficerHandoff_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "PtaBoardPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerHandoff" ADD CONSTRAINT "PtaOfficerHandoff_outgoingAssignmentId_fkey" FOREIGN KEY ("outgoingAssignmentId") REFERENCES "PtaOfficerAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerHandoff" ADD CONSTRAINT "PtaOfficerHandoff_incomingAssignmentId_fkey" FOREIGN KEY ("incomingAssignmentId") REFERENCES "PtaOfficerAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHandoffChecklistItem" ADD CONSTRAINT "PtaHandoffChecklistItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHandoffChecklistItem" ADD CONSTRAINT "PtaHandoffChecklistItem_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "PtaOfficerHandoff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaHandoffChecklistItem" ADD CONSTRAINT "PtaHandoffChecklistItem_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

