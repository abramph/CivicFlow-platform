-- CreateEnum
CREATE TYPE "PtaVolunteerPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PtaVolunteerPurchasePaymentMethod" AS ENUM ('STRIPE', 'CASH', 'CHECK', 'ZELLE', 'CASH_APP', 'OTHER');

-- CreateTable
CREATE TABLE "PtaVolunteerBuyoutPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "electionId" TEXT,
    "requirementPeriodId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "electionType" "PtaVolunteerElectionType" NOT NULL,
    "hoursElectedMinutes" INTEGER NOT NULL,
    "rateType" "PtaVolunteerRateType" NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "baseAmountCents" INTEGER NOT NULL,
    "coverageAmountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "pricingWindowId" TEXT,
    "status" "PtaVolunteerPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" "PtaVolunteerPurchasePaymentMethod" NOT NULL,
    "stripeConnectedAccountId" TEXT,
    "pendingPaymentId" TEXT,
    "providerPaymentIntentId" TEXT,
    "providerSessionId" TEXT,
    "offlineReference" TEXT,
    "offlineNotes" TEXT,
    "recordedByUserId" TEXT,
    "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerBuyoutPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerBuyoutPurchase_providerSessionId_key" ON "PtaVolunteerBuyoutPurchase"("providerSessionId");

-- CreateIndex
CREATE INDEX "PtaVolunteerBuyoutPurchase_organizationId_requirementPeriod_idx" ON "PtaVolunteerBuyoutPurchase"("organizationId", "requirementPeriodId", "householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerBuyoutPurchase_organizationId_status_idx" ON "PtaVolunteerBuyoutPurchase"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutPurchase" ADD CONSTRAINT "PtaVolunteerBuyoutPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutPurchase" ADD CONSTRAINT "PtaVolunteerBuyoutPurchase_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "PtaVolunteerBuyoutElection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutPurchase" ADD CONSTRAINT "PtaVolunteerBuyoutPurchase_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerBuyoutPurchase" ADD CONSTRAINT "PtaVolunteerBuyoutPurchase_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;
