-- CreateEnum
CREATE TYPE "PtaVolunteerPeriodType" AS ENUM ('SCHOOL_YEAR', 'TERM', 'CALENDAR_YEAR', 'MEMBERSHIP_YEAR', 'CONTRACT_PERIOD', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PtaVolunteerPeriodStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "PtaProfile" ADD COLUMN     "ptaVolunteerAssessmentsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptaVolunteerBuyoutEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptaVolunteerNativeMobileEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptaVolunteerNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptaVolunteerReportsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ptaVolunteerRequirementsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PtaVolunteerRequirementPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodType" "PtaVolunteerPeriodType" NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "requiredMinutesDefault" INTEGER NOT NULL,
    "volunteerDeadline" TIMESTAMP(3),
    "buyoutWindowStart" TIMESTAMP(3),
    "buyoutWindowEnd" TIMESTAMP(3),
    "assessmentDate" TIMESTAMP(3),
    "assessmentPaymentDueDate" TIMESTAMP(3),
    "status" "PtaVolunteerPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "adminNotes" TEXT,
    "familyPolicyText" TEXT,
    "scopeLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerRequirementPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerRequirementPeriod_organizationId_status_idx" ON "PtaVolunteerRequirementPeriod"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaVolunteerRequirementPeriod_organizationId_startsOn_endsO_idx" ON "PtaVolunteerRequirementPeriod"("organizationId", "startsOn", "endsOn");

-- AddForeignKey
ALTER TABLE "PtaVolunteerRequirementPeriod" ADD CONSTRAINT "PtaVolunteerRequirementPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
