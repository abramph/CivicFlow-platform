-- CreateEnum
CREATE TYPE "PtaStudentProgressionBatchStatus" AS ENUM ('PREPARING', 'PREVIEWED', 'COMMITTED', 'CORRECTED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "PtaStudentProgressionOutcome" AS ENUM ('PROMOTE', 'RETAIN', 'GRADUATE', 'TRANSFER', 'WITHDRAW', 'EXCLUDE', 'MANUAL', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PtaStudentProgressionRecordStatus" AS ENUM ('PLANNED', 'APPLIED', 'SKIPPED', 'FAILED');

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'PTA_HOUSEHOLD';

-- AlterTable
ALTER TABLE "PtaProfile" ADD COLUMN     "studentProgressionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PtaHousehold" ADD COLUMN     "photoUrl" TEXT;

-- CreateTable
CREATE TABLE "PtaStudentProgressionBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromSchoolYearId" TEXT NOT NULL,
    "toSchoolYearId" TEXT NOT NULL,
    "status" "PtaStudentProgressionBatchStatus" NOT NULL DEFAULT 'PREPARING',
    "notes" TEXT,
    "commitIdempotencyKey" TEXT,
    "preparedByUserId" TEXT,
    "previewedAt" TIMESTAMP(3),
    "committedByUserId" TEXT,
    "committedAt" TIMESTAMP(3),
    "correctedByUserId" TEXT,
    "correctedAt" TIMESTAMP(3),
    "rolledBackByUserId" TEXT,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaStudentProgressionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaStudentProgressionRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sourceEnrollmentId" TEXT,
    "targetEnrollmentId" TEXT,
    "outcome" "PtaStudentProgressionOutcome" NOT NULL,
    "sourceGradeId" TEXT,
    "targetGradeId" TEXT,
    "sourceClassroomId" TEXT,
    "targetClassroomId" TEXT,
    "exceptionReason" TEXT,
    "status" "PtaStudentProgressionRecordStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaStudentProgressionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaProgressionClassroomMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceClassroomId" TEXT NOT NULL,
    "targetClassroomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaProgressionClassroomMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PtaStudentProgressionBatch_commitIdempotencyKey_key" ON "PtaStudentProgressionBatch"("commitIdempotencyKey");

-- CreateIndex
CREATE INDEX "PtaStudentProgressionBatch_organizationId_idx" ON "PtaStudentProgressionBatch"("organizationId");

-- CreateIndex
CREATE INDEX "PtaStudentProgressionBatch_organizationId_status_idx" ON "PtaStudentProgressionBatch"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PtaStudentProgressionBatch_organizationId_fromSchoolYearId__key" ON "PtaStudentProgressionBatch"("organizationId", "fromSchoolYearId", "toSchoolYearId");

-- CreateIndex
CREATE INDEX "PtaStudentProgressionRecord_organizationId_idx" ON "PtaStudentProgressionRecord"("organizationId");

-- CreateIndex
CREATE INDEX "PtaStudentProgressionRecord_batchId_outcome_idx" ON "PtaStudentProgressionRecord"("batchId", "outcome");

-- CreateIndex
CREATE INDEX "PtaStudentProgressionRecord_studentId_idx" ON "PtaStudentProgressionRecord"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaStudentProgressionRecord_batchId_studentId_key" ON "PtaStudentProgressionRecord"("batchId", "studentId");

-- CreateIndex
CREATE INDEX "PtaProgressionClassroomMapping_organizationId_idx" ON "PtaProgressionClassroomMapping"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaProgressionClassroomMapping_batchId_sourceClassroomId_key" ON "PtaProgressionClassroomMapping"("batchId", "sourceClassroomId");

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionBatch" ADD CONSTRAINT "PtaStudentProgressionBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionBatch" ADD CONSTRAINT "PtaStudentProgressionBatch_fromSchoolYearId_fkey" FOREIGN KEY ("fromSchoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionBatch" ADD CONSTRAINT "PtaStudentProgressionBatch_toSchoolYearId_fkey" FOREIGN KEY ("toSchoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionRecord" ADD CONSTRAINT "PtaStudentProgressionRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionRecord" ADD CONSTRAINT "PtaStudentProgressionRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PtaStudentProgressionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionRecord" ADD CONSTRAINT "PtaStudentProgressionRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "PtaStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionRecord" ADD CONSTRAINT "PtaStudentProgressionRecord_sourceEnrollmentId_fkey" FOREIGN KEY ("sourceEnrollmentId") REFERENCES "PtaStudentEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentProgressionRecord" ADD CONSTRAINT "PtaStudentProgressionRecord_targetEnrollmentId_fkey" FOREIGN KEY ("targetEnrollmentId") REFERENCES "PtaStudentEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaProgressionClassroomMapping" ADD CONSTRAINT "PtaProgressionClassroomMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaProgressionClassroomMapping" ADD CONSTRAINT "PtaProgressionClassroomMapping_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PtaStudentProgressionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

