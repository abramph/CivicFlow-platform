-- CreateEnum
CREATE TYPE "PtaVolunteerAssessmentBatchStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PtaVolunteerAssessmentLineStatus" AS ENUM ('INCLUDED', 'EXCLUDED', 'POSTED');

-- CreateEnum
CREATE TYPE "PtaVolunteerAssessmentChargeStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "PtaVolunteerAssessmentBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "status" "PtaVolunteerAssessmentBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "supersedesBatchId" TEXT,
    "rateCents" INTEGER NOT NULL,
    "pricingWindowId" TEXT,
    "previewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previewedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerAssessmentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerAssessmentLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "adjustedRequiredMinutes" INTEGER NOT NULL,
    "verifiedMinutes" INTEGER NOT NULL,
    "purchasedMinutes" INTEGER NOT NULL,
    "creditMinutes" INTEGER NOT NULL,
    "waivedMinutes" INTEGER NOT NULL,
    "remainingMinutes" INTEGER NOT NULL,
    "assessmentCents" INTEGER NOT NULL,
    "status" "PtaVolunteerAssessmentLineStatus" NOT NULL DEFAULT 'INCLUDED',
    "excludeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ptaVolunteerRequirementPeriodId" TEXT,

    CONSTRAINT "PtaVolunteerAssessmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaVolunteerAssessmentCharge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "status" "PtaVolunteerAssessmentChargeStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3),
    "paymentMethod" "PtaVolunteerPurchasePaymentMethod",
    "stripeConnectedAccountId" TEXT,
    "pendingPaymentId" TEXT,
    "providerPaymentIntentId" TEXT,
    "providerSessionId" TEXT,
    "offlineReference" TEXT,
    "offlineNotes" TEXT,
    "recordedByUserId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerAssessmentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerAssessmentBatch_organizationId_requirementPerio_idx" ON "PtaVolunteerAssessmentBatch"("organizationId", "requirementPeriodId");

-- CreateIndex
CREATE INDEX "PtaVolunteerAssessmentBatch_organizationId_status_idx" ON "PtaVolunteerAssessmentBatch"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaVolunteerAssessmentLine_organizationId_batchId_idx" ON "PtaVolunteerAssessmentLine"("organizationId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerAssessmentLine_batchId_householdId_key" ON "PtaVolunteerAssessmentLine"("batchId", "householdId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerAssessmentCharge_lineId_key" ON "PtaVolunteerAssessmentCharge"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerAssessmentCharge_providerSessionId_key" ON "PtaVolunteerAssessmentCharge"("providerSessionId");

-- CreateIndex
CREATE INDEX "PtaVolunteerAssessmentCharge_organizationId_requirementPeri_idx" ON "PtaVolunteerAssessmentCharge"("organizationId", "requirementPeriodId", "householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerAssessmentCharge_organizationId_status_idx" ON "PtaVolunteerAssessmentCharge"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentBatch" ADD CONSTRAINT "PtaVolunteerAssessmentBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentBatch" ADD CONSTRAINT "PtaVolunteerAssessmentBatch_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentBatch" ADD CONSTRAINT "PtaVolunteerAssessmentBatch_supersedesBatchId_fkey" FOREIGN KEY ("supersedesBatchId") REFERENCES "PtaVolunteerAssessmentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentLine" ADD CONSTRAINT "PtaVolunteerAssessmentLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentLine" ADD CONSTRAINT "PtaVolunteerAssessmentLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PtaVolunteerAssessmentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentLine" ADD CONSTRAINT "PtaVolunteerAssessmentLine_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentLine" ADD CONSTRAINT "PtaVolunteerAssessmentLine_ptaVolunteerRequirementPeriodId_fkey" FOREIGN KEY ("ptaVolunteerRequirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentCharge" ADD CONSTRAINT "PtaVolunteerAssessmentCharge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentCharge" ADD CONSTRAINT "PtaVolunteerAssessmentCharge_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentCharge" ADD CONSTRAINT "PtaVolunteerAssessmentCharge_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentCharge" ADD CONSTRAINT "PtaVolunteerAssessmentCharge_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PtaVolunteerAssessmentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerAssessmentCharge" ADD CONSTRAINT "PtaVolunteerAssessmentCharge_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PtaVolunteerAssessmentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
