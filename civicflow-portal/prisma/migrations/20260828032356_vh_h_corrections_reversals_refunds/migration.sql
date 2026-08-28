-- CreateEnum
CREATE TYPE "PtaVolunteerReviewFlagType" AS ENUM ('CORRECTION_AFTER_ASSESSMENT_POSTED', 'POTENTIAL_OVERPAYMENT_AFTER_REQUIREMENT_REDUCED', 'REFUND_CREATES_DEFICIT');

-- CreateEnum
CREATE TYPE "PtaVolunteerReviewFlagStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "PtaVolunteerBuyoutPurchase" ADD COLUMN     "refundedMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PtaVolunteerReviewFlag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "flagType" "PtaVolunteerReviewFlagType" NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "status" "PtaVolunteerReviewFlagStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerReviewFlag_organizationId_requirementPeriodId_s_idx" ON "PtaVolunteerReviewFlag"("organizationId", "requirementPeriodId", "status");

-- CreateIndex
CREATE INDEX "PtaVolunteerReviewFlag_organizationId_householdId_idx" ON "PtaVolunteerReviewFlag"("organizationId", "householdId");

-- AddForeignKey
ALTER TABLE "PtaVolunteerReviewFlag" ADD CONSTRAINT "PtaVolunteerReviewFlag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerReviewFlag" ADD CONSTRAINT "PtaVolunteerReviewFlag_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerReviewFlag" ADD CONSTRAINT "PtaVolunteerReviewFlag_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
