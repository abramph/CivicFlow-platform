-- AlterTable
ALTER TABLE "ReportExport" ADD COLUMN     "artifactCleanupAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "artifactCleanupCompletedAt" TIMESTAMP(3),
ADD COLUMN     "artifactCleanupError" TEXT,
ADD COLUMN     "artifactCleanupNextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "artifactCleanupPending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ReportExport_artifactCleanupPending_artifactCleanupNextAtte_idx" ON "ReportExport"("artifactCleanupPending", "artifactCleanupNextAttemptAt");
