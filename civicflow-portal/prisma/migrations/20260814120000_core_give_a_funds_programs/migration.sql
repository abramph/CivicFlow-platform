-- CreateEnum
CREATE TYPE "GivingModuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ObligationNature" AS ENUM ('REQUIRED', 'VOLUNTARY');

-- CreateEnum
CREATE TYPE "ContributionProgramType" AS ENUM ('DUES', 'VOLUNTARY_CONTRIBUTION', 'SUGGESTED_CONTRIBUTION', 'ONE_TIME_GIVING', 'PLEDGE_CAMPAIGN', 'FUNDRAISER', 'SPECIAL_OFFERING', 'SPONSORSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "ContributionProgramVisibility" AS ENUM ('MEMBERS', 'PUBLIC', 'HIDDEN');

-- CreateEnum
CREATE TYPE "TaxDeductibilityClassification" AS ENUM ('DEDUCTIBILITY_NOT_CONFIGURED', 'ORGANIZATION_MARKED_POTENTIALLY_DEDUCTIBLE', 'NOT_DEDUCTIBLE', 'PARTIALLY_DEDUCTIBLE', 'REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "ContributionAnonymityMode" AS ENUM ('NONE', 'PUBLICLY_ANONYMOUS');

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "contributionTerminology" TEXT,
ADD COLUMN     "contributionsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "anonymityMode" "ContributionAnonymityMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "contributionNumber" TEXT,
ADD COLUMN     "contributionProgramId" TEXT,
ADD COLUMN     "contributorUserId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "fundId" TEXT,
ADD COLUMN     "goodsServicesValue" DECIMAL(12,2),
ADD COLUMN     "providerChargeId" TEXT,
ADD COLUMN     "providerInvoiceId" TEXT,
ADD COLUMN     "providerPaymentIntentId" TEXT,
ADD COLUMN     "statementEligible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxDeductibilityClassification" "TaxDeductibilityClassification" NOT NULL DEFAULT 'DEDUCTIBILITY_NOT_CONFIGURED';

-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "shortCode" TEXT,
    "status" "GivingModuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "allowOneTime" BOOLEAN NOT NULL DEFAULT true,
    "allowRecurring" BOOLEAN NOT NULL DEFAULT true,
    "allowPledges" BOOLEAN NOT NULL DEFAULT false,
    "suggestedAmounts" DECIMAL(12,2)[],
    "minimumAmount" DECIMAL(12,2),
    "maximumAmount" DECIMAL(12,2),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "accountingCode" TEXT,
    "externalAccountingRef" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ContributionProgramType" NOT NULL DEFAULT 'VOLUNTARY_CONTRIBUTION',
    "obligationNature" "ObligationNature" NOT NULL DEFAULT 'VOLUNTARY',
    "allowCustomAmount" BOOLEAN NOT NULL DEFAULT true,
    "suggestedAmounts" DECIMAL(12,2)[],
    "defaultAmount" DECIMAL(12,2),
    "allowedFrequencies" TEXT[],
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "visibility" "ContributionProgramVisibility" NOT NULL DEFAULT 'MEMBERS',
    "receiptLanguage" TEXT,
    "taxDeductibility" "TaxDeductibilityClassification" NOT NULL DEFAULT 'DEDUCTIBILITY_NOT_CONFIGURED',
    "status" "GivingModuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fund_organizationId_idx" ON "Fund"("organizationId");

-- CreateIndex
CREATE INDEX "Fund_organizationId_status_idx" ON "Fund"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_organizationId_name_key" ON "Fund"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ContributionProgram_organizationId_idx" ON "ContributionProgram"("organizationId");

-- CreateIndex
CREATE INDEX "ContributionProgram_organizationId_status_idx" ON "ContributionProgram"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ContributionProgram_fundId_idx" ON "ContributionProgram"("fundId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionProgram_organizationId_name_key" ON "ContributionProgram"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Contribution_fundId_idx" ON "Contribution"("fundId");

-- CreateIndex
CREATE INDEX "Contribution_contributionProgramId_idx" ON "Contribution"("contributionProgramId");

-- CreateIndex
CREATE INDEX "Contribution_providerPaymentIntentId_idx" ON "Contribution"("providerPaymentIntentId");

-- CreateIndex
CREATE INDEX "Contribution_contributorUserId_idx" ON "Contribution"("contributorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_organizationId_contributionNumber_key" ON "Contribution"("organizationId", "contributionNumber");

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_contributionProgramId_fkey" FOREIGN KEY ("contributionProgramId") REFERENCES "ContributionProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_contributorUserId_fkey" FOREIGN KEY ("contributorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionProgram" ADD CONSTRAINT "ContributionProgram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionProgram" ADD CONSTRAINT "ContributionProgram_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

