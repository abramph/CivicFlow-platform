-- CreateEnum
CREATE TYPE "PtaVolunteerSlotStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PtaVolunteerSignupSource" AS ENUM ('SELF', 'OFFICER_MANUAL');

-- CreateEnum
CREATE TYPE "PtaVolunteerEntrySource" AS ENUM ('OFFICER_MANUAL', 'SELF_REPORTED', 'QR', 'MOBILE', 'IMPORT');

-- CreateEnum
CREATE TYPE "PtaVolunteerAttendanceStatus" AS ENUM ('ATTENDED', 'PARTIAL', 'NO_SHOW', 'EXCUSED');

-- CreateEnum
CREATE TYPE "PtaVolunteerHourEntryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'VOIDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PtaVolunteerOpportunityStatus" ADD VALUE 'DRAFT';
ALTER TYPE "PtaVolunteerOpportunityStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PtaVolunteerSignupStatus" ADD VALUE 'WAITLISTED';
ALTER TYPE "PtaVolunteerSignupStatus" ADD VALUE 'ATTENDED';
ALTER TYPE "PtaVolunteerSignupStatus" ADD VALUE 'PARTIAL';
ALTER TYPE "PtaVolunteerSignupStatus" ADD VALUE 'NO_SHOW';
ALTER TYPE "PtaVolunteerSignupStatus" ADD VALUE 'EXCUSED';

-- AlterTable
ALTER TABLE "PtaVolunteerOpportunity" ADD COLUMN     "cancellationDeadline" TIMESTAMP(3),
ADD COLUMN     "committeeId" TEXT,
ADD COLUMN     "coordinatorUserId" TEXT,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "schoolYear" TEXT;

-- AlterTable
ALTER TABLE "PtaVolunteerSignup" ADD COLUMN     "assignedByUserId" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "householdId" TEXT,
ADD COLUMN     "manuallyAssigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "source" "PtaVolunteerSignupSource" NOT NULL DEFAULT 'SELF';

-- AlterTable
ALTER TABLE "PtaVolunteerSlot" ADD COLUMN     "defaultCreditedMinutes" INTEGER,
ADD COLUMN     "locationOverride" TEXT,
ADD COLUMN     "minNeeded" INTEGER,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "PtaVolunteerSlotStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "PtaVolunteerAttendance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "signupId" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "status" "PtaVolunteerAttendanceStatus",
    "recordedByUserId" TEXT,
    "source" "PtaVolunteerEntrySource" NOT NULL DEFAULT 'OFFICER_MANUAL',
    "officerNotes" TEXT,
    "parentNotes" TEXT,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerHourEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "signupId" TEXT NOT NULL,
    "householdAdultId" TEXT NOT NULL,
    "householdId" TEXT,
    "opportunityId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "creditedMinutes" INTEGER NOT NULL,
    "status" "PtaVolunteerHourEntryStatus" NOT NULL DEFAULT 'PENDING',
    "source" "PtaVolunteerEntrySource" NOT NULL DEFAULT 'OFFICER_MANUAL',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerHourEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerHourAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hourEntryId" TEXT NOT NULL,
    "minuteAdjustment" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaVolunteerHourAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "requiredMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerAttendance_signupId_key" ON "PtaVolunteerAttendance"("signupId");

-- CreateIndex
CREATE INDEX "PtaVolunteerAttendance_organizationId_idx" ON "PtaVolunteerAttendance"("organizationId");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourEntry_organizationId_schoolYear_idx" ON "PtaVolunteerHourEntry"("organizationId", "schoolYear");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourEntry_householdAdultId_idx" ON "PtaVolunteerHourEntry"("householdAdultId");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourEntry_householdId_idx" ON "PtaVolunteerHourEntry"("householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourEntry_opportunityId_idx" ON "PtaVolunteerHourEntry"("opportunityId");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourEntry_status_idx" ON "PtaVolunteerHourEntry"("status");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourAdjustment_organizationId_idx" ON "PtaVolunteerHourAdjustment"("organizationId");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourAdjustment_hourEntryId_idx" ON "PtaVolunteerHourAdjustment"("hourEntryId");

-- CreateIndex
CREATE INDEX "PtaVolunteerRequirement_organizationId_idx" ON "PtaVolunteerRequirement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerRequirement_organizationId_schoolYear_key" ON "PtaVolunteerRequirement"("organizationId", "schoolYear");

-- CreateIndex
CREATE INDEX "PtaVolunteerOpportunity_organizationId_schoolYear_idx" ON "PtaVolunteerOpportunity"("organizationId", "schoolYear");

-- CreateIndex
CREATE INDEX "PtaVolunteerOpportunity_committeeId_idx" ON "PtaVolunteerOpportunity"("committeeId");

-- CreateIndex
CREATE INDEX "PtaVolunteerSignup_householdId_idx" ON "PtaVolunteerSignup"("householdId");

-- AddForeignKey
ALTER TABLE "PtaVolunteerOpportunity" ADD CONSTRAINT "PtaVolunteerOpportunity_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "PtaCommittee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAttendance" ADD CONSTRAINT "PtaVolunteerAttendance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAttendance" ADD CONSTRAINT "PtaVolunteerAttendance_signupId_fkey" FOREIGN KEY ("signupId") REFERENCES "PtaVolunteerSignup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerHourEntry" ADD CONSTRAINT "PtaVolunteerHourEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerHourEntry" ADD CONSTRAINT "PtaVolunteerHourEntry_signupId_fkey" FOREIGN KEY ("signupId") REFERENCES "PtaVolunteerSignup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerHourAdjustment" ADD CONSTRAINT "PtaVolunteerHourAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerHourAdjustment" ADD CONSTRAINT "PtaVolunteerHourAdjustment_hourEntryId_fkey" FOREIGN KEY ("hourEntryId") REFERENCES "PtaVolunteerHourEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerRequirement" ADD CONSTRAINT "PtaVolunteerRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
