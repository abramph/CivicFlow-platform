-- CreateEnum
CREATE TYPE "ContributionAdjustmentKind" AS ENUM ('FUND_RECLASSIFICATION', 'ATTRIBUTION_CORRECTION');

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "providerDisputeStatus" TEXT,
ADD COLUMN     "providerRefundId" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAmount" DECIMAL(12,2),
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedByUserId" TEXT;

-- CreateTable
CREATE TABLE "ContributionAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contributionId" TEXT NOT NULL,
    "kind" "ContributionAdjustmentKind" NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContributionAdjustment_organizationId_createdAt_idx" ON "ContributionAdjustment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ContributionAdjustment_contributionId_idx" ON "ContributionAdjustment"("contributionId");

-- AddForeignKey
ALTER TABLE "ContributionAdjustment" ADD CONSTRAINT "ContributionAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionAdjustment" ADD CONSTRAINT "ContributionAdjustment_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "Contribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

