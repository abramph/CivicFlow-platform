-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('COMMUNITY_MEMBERS', 'PTA_HOUSEHOLDS', 'HOA_PROPERTIES');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'ANALYZING', 'READY_FOR_REVIEW', 'IMPORTING', 'PARTIALLY_COMPLETED', 'PAUSED_PLAN_LIMIT', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'NEW', 'EXACT_DUPLICATE', 'POSSIBLE_DUPLICATE', 'UPDATE_AVAILABLE', 'IMPORTED', 'SKIPPED', 'INVALID', 'FAILED', 'BLOCKED_PLAN_LIMIT');

-- CreateEnum
CREATE TYPE "ImportRowDecision" AS ENUM ('IMPORT_NEW', 'SKIP', 'UPDATE_EXISTING', 'CREATE_ANYWAY', 'REVIEW_REQUIRED');

-- AlterTable
ALTER TABLE "PaymentImportBatch" ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "retentionExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importKind" "ImportKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "storageObjectKey" TEXT,
    "columnMapping" JSONB NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedPlanLimitCount" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "planLimitSnapshot" JSONB,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzedAt" TIMESTAMP(3),
    "importStartedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "retentionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "normalizedData" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "decision" "ImportRowDecision",
    "matchedRecordId" TEXT,
    "matchConfidence" INTEGER,
    "errorMessage" TEXT,
    "importedRecordId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_organizationId_idx" ON "ImportBatch"("organizationId");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ImportBatch_organizationId_importKind_fileHash_idx" ON "ImportBatch"("organizationId", "importKind", "fileHash");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_idx" ON "ImportRow"("batchId");

-- CreateIndex
CREATE INDEX "ImportRow_organizationId_idx" ON "ImportRow"("organizationId");

-- CreateIndex
CREATE INDEX "ImportRow_status_idx" ON "ImportRow"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_rowNumber_key" ON "ImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "PaymentImportBatch_organizationId_sourceType_fileHash_idx" ON "PaymentImportBatch"("organizationId", "sourceType", "fileHash");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
