-- CreateEnum
CREATE TYPE "PtaVolunteerRateType" AS ENUM ('FULL_BUYOUT', 'PER_HOUR', 'FINAL_ASSESSMENT');

-- CreateEnum
CREATE TYPE "PtaVolunteerRateLockTiming" AS ENUM ('CHECKOUT_START', 'PAYMENT_SUCCESS');

-- CreateTable
CREATE TABLE "PtaVolunteerPricingWindow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "rateType" "PtaVolunteerRateType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "contractSigningOnly" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lockTiming" "PtaVolunteerRateLockTiming" NOT NULL DEFAULT 'PAYMENT_SUCCESS',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerPricingWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerPricingWindow_organizationId_periodId_idx" ON "PtaVolunteerPricingWindow"("organizationId", "periodId");

-- CreateIndex
CREATE INDEX "PtaVolunteerPricingWindow_periodId_rateType_active_idx" ON "PtaVolunteerPricingWindow"("periodId", "rateType", "active");

-- AddForeignKey
ALTER TABLE "PtaVolunteerPricingWindow" ADD CONSTRAINT "PtaVolunteerPricingWindow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerPricingWindow" ADD CONSTRAINT "PtaVolunteerPricingWindow_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
