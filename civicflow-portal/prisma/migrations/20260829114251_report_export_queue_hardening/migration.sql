-- AlterTable
ALTER TABLE "ReportExport" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimId" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReportExport_status_nextAttemptAt_idx" ON "ReportExport"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ReportExport_status_leaseExpiresAt_idx" ON "ReportExport"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ReportExport_status_expiresAt_idx" ON "ReportExport"("status", "expiresAt");
