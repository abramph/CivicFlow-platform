-- CreateEnum
CREATE TYPE "ProcessingCostCoverageMode" AS ENUM ('OFF', 'OPTIONAL_CONTRIBUTOR_COVERAGE', 'STRIPE_SURCHARGE');

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "processingCostCoverageFixedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processingCostCoverageMode" "ProcessingCostCoverageMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "processingCostCoveragePercentBps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "processingCostCoverageAmount" DECIMAL(12,2),
ADD COLUMN     "totalChargedAmount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "RecurringContributionSchedule" ADD COLUMN     "coverProcessingCosts" BOOLEAN NOT NULL DEFAULT false;

