-- CreateEnum
CREATE TYPE "PtaVolunteerElectionType" AS ENUM ('VOLUNTEER', 'FULL_BUYOUT', 'PARTIAL_BUYOUT');

-- CreateEnum
CREATE TYPE "PtaVolunteerHourDisputeStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "PtaVolunteerRequirementPeriod" ADD COLUMN     "buyoutFullAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "buyoutIncrementMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "buyoutMaxPurchaseMinutes" INTEGER,
ADD COLUMN     "buyoutMinPurchaseMinutes" INTEGER,
ADD COLUMN     "buyoutMinServiceMinutes" INTEGER;

-- CreateTable
CREATE TABLE "PtaVolunteerBuyoutElection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "electionType" "PtaVolunteerElectionType" NOT NULL,
    "hoursElectedMinutes" INTEGER NOT NULL,
    "quotedRateCents" INTEGER NOT NULL,
    "quotedTotalCents" INTEGER NOT NULL,
    "pricingWindowId" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedByUserId" TEXT NOT NULL,
    "ackVersion" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaVolunteerBuyoutElection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerHourDispute" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PtaVolunteerHourDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "adminNotes" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerHourDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerBuyoutElection_organizationId_requirementPeriod_idx" ON "PtaVolunteerBuyoutElection"("organizationId", "requirementPeriodId", "householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerBuyoutElection_organizationId_householdId_idx" ON "PtaVolunteerBuyoutElection"("organizationId", "householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourDispute_organizationId_requirementPeriodId__idx" ON "PtaVolunteerHourDispute"("organizationId", "requirementPeriodId", "status");

-- CreateIndex
CREATE INDEX "PtaVolunteerHourDispute_organizationId_householdId_idx" ON "PtaVolunteerHourDispute"("organizationId", "householdId");

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutElection" ADD CONSTRAINT "PtaVolunteerBuyoutElection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutElection" ADD CONSTRAINT "PtaVolunteerBuyoutElection_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutElection" ADD CONSTRAINT "PtaVolunteerBuyoutElection_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerHourDispute" ADD CONSTRAINT "PtaVolunteerHourDispute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerHourDispute" ADD CONSTRAINT "PtaVolunteerHourDispute_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerHourDispute" ADD CONSTRAINT "PtaVolunteerHourDispute_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
