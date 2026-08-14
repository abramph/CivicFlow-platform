-- CreateEnum
CREATE TYPE "PledgeStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "fundId" TEXT;

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "pledgeId" TEXT;

-- AlterTable
ALTER TABLE "RecurringContributionSchedule" ADD COLUMN     "pledgeId" TEXT;

-- CreateTable
CREATE TABLE "Pledge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT,
    "contributorUserId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "campaignId" TEXT,
    "pledgedAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pledgeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" TIMESTAMP(3),
    "targetCompletionDate" TIMESTAMP(3),
    "status" "PledgeStatus" NOT NULL DEFAULT 'ACTIVE',
    "allowPublicRecognition" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pledge_organizationId_idx" ON "Pledge"("organizationId");

-- CreateIndex
CREATE INDEX "Pledge_organizationId_status_idx" ON "Pledge"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Pledge_contributorUserId_idx" ON "Pledge"("contributorUserId");

-- CreateIndex
CREATE INDEX "Pledge_fundId_idx" ON "Pledge"("fundId");

-- CreateIndex
CREATE INDEX "Pledge_campaignId_idx" ON "Pledge"("campaignId");

-- CreateIndex
CREATE INDEX "Contribution_pledgeId_idx" ON "Contribution"("pledgeId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "Pledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringContributionSchedule" ADD CONSTRAINT "RecurringContributionSchedule_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "Pledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_contributorUserId_fkey" FOREIGN KEY ("contributorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pledge" ADD CONSTRAINT "Pledge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

