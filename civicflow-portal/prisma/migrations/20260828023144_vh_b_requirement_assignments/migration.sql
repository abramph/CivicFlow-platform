-- CreateEnum
CREATE TYPE "PtaVolunteerScopeType" AS ENUM ('ALL', 'MEMBERSHIP_PLAN', 'GRADE', 'CLASSROOM', 'PROGRAM', 'HOUSEHOLD');

-- CreateEnum
CREATE TYPE "PtaVolunteerAssignmentType" AS ENUM ('STANDARD', 'PER_CHILD', 'PER_ADULT', 'CUSTOM', 'REDUCED', 'EXEMPT_FULL', 'EXEMPT_TEMPORARY', 'WAIVER');

-- CreateTable
CREATE TABLE "PtaVolunteerRequirementAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "scopeType" "PtaVolunteerScopeType" NOT NULL,
    "scopeRefId" TEXT,
    "householdId" TEXT,
    "assignmentType" "PtaVolunteerAssignmentType" NOT NULL DEFAULT 'STANDARD',
    "requiredMinutesOverride" INTEGER,
    "reason" TEXT,
    "exemptUntil" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerRequirementAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerRequirementAssignment_organizationId_periodId_idx" ON "PtaVolunteerRequirementAssignment"("organizationId", "periodId");

-- CreateIndex
CREATE INDEX "PtaVolunteerRequirementAssignment_organizationId_householdI_idx" ON "PtaVolunteerRequirementAssignment"("organizationId", "householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerRequirementAssignment_periodId_scopeType_scopeR_idx" ON "PtaVolunteerRequirementAssignment"("periodId", "scopeType", "scopeRefId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerRequirementAssignment_periodId_householdId_scop_key" ON "PtaVolunteerRequirementAssignment"("periodId", "householdId", "scopeType");

-- AddForeignKey
ALTER TABLE "PtaVolunteerRequirementAssignment" ADD CONSTRAINT "PtaVolunteerRequirementAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerRequirementAssignment" ADD CONSTRAINT "PtaVolunteerRequirementAssignment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerRequirementAssignment" ADD CONSTRAINT "PtaVolunteerRequirementAssignment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
