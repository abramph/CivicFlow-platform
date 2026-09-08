-- CreateEnum
CREATE TYPE "PtaFamilyChangeRequestStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PtaFamilyChangeRequestType" AS ENUM ('HOUSEHOLD_DISPLAY_NAME', 'ADD_STUDENT', 'RENAME_STUDENT', 'STUDENT_PLACEMENT', 'REMOVE_STUDENT');

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'PTA_STUDENT';

-- AlterTable
ALTER TABLE "PtaStudent" ADD COLUMN     "photoUrl" TEXT;

-- CreateTable
CREATE TABLE "PtaFamilyChangeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "submittedByAdultId" TEXT,
    "type" "PtaFamilyChangeRequestType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PtaFamilyChangeRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "decisionNotes" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaFamilyChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaFamilyChangeRequest_organizationId_status_createdAt_idx" ON "PtaFamilyChangeRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PtaFamilyChangeRequest_householdId_idx" ON "PtaFamilyChangeRequest"("householdId");

-- AddForeignKey
ALTER TABLE "PtaFamilyChangeRequest" ADD CONSTRAINT "PtaFamilyChangeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaFamilyChangeRequest" ADD CONSTRAINT "PtaFamilyChangeRequest_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaFamilyChangeRequest" ADD CONSTRAINT "PtaFamilyChangeRequest_submittedByAdultId_fkey" FOREIGN KEY ("submittedByAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
-- Pre-existing drift reconciliation Prisma emits for ANY new migration, not a
-- Build 27 change: the hand-written progression migration
-- (20260904150000_pta_progression_active_transition_unique) named this
-- ordinary secondary index slightly differently than Prisma's own
-- truncation convention. Rename only — same columns, same definition.
-- scripts/verify-progression-constraint.mjs checks the PARTIAL unique index
-- ("PtaStudentProgressionBatch_active_transition_key"), which is untouched.
ALTER INDEX "PtaStudentProgressionBatch_organizationId_toSchoolYearId_pub_id" RENAME TO "PtaStudentProgressionBatch_organizationId_toSchoolYearId_pu_idx";
