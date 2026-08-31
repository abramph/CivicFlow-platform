-- CreateEnum
CREATE TYPE "PtaVolunteerAgreementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "PtaVolunteerRequirementPeriod" ADD COLUMN     "agreementRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agreementVersionId" TEXT,
ADD COLUMN     "contractLinkedBuyoutEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contractLinkedEligibilityDays" INTEGER,
ADD COLUMN     "contractLinkedUsesAcceptanceRate" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PtaVolunteerBuyoutElection" ADD COLUMN     "contractAcceptanceId" TEXT;

-- CreateTable
CREATE TABLE "PtaVolunteerAgreementVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "PtaVolunteerAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerAgreementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerAgreementAcceptance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "agreementVersionId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "acceptedByUserId" TEXT NOT NULL,
    "acceptedByAdultId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "contentHashAtAcceptance" TEXT NOT NULL,
    "ackVersion" TEXT NOT NULL,
    "typedName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaVolunteerAgreementAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerAgreementVersion_organizationId_requirementPeri_idx" ON "PtaVolunteerAgreementVersion"("organizationId", "requirementPeriodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerAgreementVersion_organizationId_requirementPeri_key" ON "PtaVolunteerAgreementVersion"("organizationId", "requirementPeriodId", "versionNumber");

-- CreateIndex
CREATE INDEX "PtaVolunteerAgreementAcceptance_organizationId_requirementP_idx" ON "PtaVolunteerAgreementAcceptance"("organizationId", "requirementPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerAgreementAcceptance_organizationId_householdId__key" ON "PtaVolunteerAgreementAcceptance"("organizationId", "householdId", "agreementVersionId");

-- AddForeignKey
ALTER TABLE "PtaVolunteerRequirementPeriod" ADD CONSTRAINT "PtaVolunteerRequirementPeriod_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "PtaVolunteerAgreementVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutElection" ADD CONSTRAINT "PtaVolunteerBuyoutElection_contractAcceptanceId_fkey" FOREIGN KEY ("contractAcceptanceId") REFERENCES "PtaVolunteerAgreementAcceptance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAgreementVersion" ADD CONSTRAINT "PtaVolunteerAgreementVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAgreementVersion" ADD CONSTRAINT "PtaVolunteerAgreementVersion_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "PtaVolunteerAgreementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_acceptedByAdultId_fkey" FOREIGN KEY ("acceptedByAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

