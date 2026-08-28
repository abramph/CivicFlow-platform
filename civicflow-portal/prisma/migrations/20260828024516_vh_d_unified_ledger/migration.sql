-- CreateEnum
CREATE TYPE "PtaVolunteerCategory" AS ENUM ('EVENT_SERVICE', 'COMMITTEE_SERVICE', 'CLASSROOM_SERVICE', 'SCHOOL_ACTIVITY', 'FUNDRAISING', 'ADMINISTRATIVE_SUPPORT', 'AT_HOME_SERVICE', 'DONATED_GOODS', 'OTHER_APPROVED_SERVICE');

-- CreateEnum
CREATE TYPE "PtaVolunteerLedgerEntryType" AS ENUM ('SERVICE_VERIFIED', 'CORRECTED', 'PURCHASE', 'PURCHASE_REFUND', 'ADMIN_CREDIT', 'WAIVER', 'REQUIREMENT_CHANGE', 'ASSESSMENT_CHARGE', 'PAYMENT_ELECTRONIC', 'PAYMENT_OFFLINE', 'REFUND', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "PtaVolunteerLedgerApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'VOIDED');

-- AlterTable
ALTER TABLE "PtaProfile" ADD COLUMN     "donatedGoodsAsHoursEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PtaVolunteerHourEntry" ADD COLUMN     "category" "PtaVolunteerCategory";

-- CreateTable
CREATE TABLE "PtaVolunteerLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementPeriodId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "householdAdultId" TEXT,
    "entryType" "PtaVolunteerLedgerEntryType" NOT NULL,
    "category" "PtaVolunteerCategory",
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "approvalStatus" "PtaVolunteerLedgerApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "description" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "approvedByUserId" TEXT,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaVolunteerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaVolunteerLedgerEntry_organizationId_requirementPeriodId__idx" ON "PtaVolunteerLedgerEntry"("organizationId", "requirementPeriodId", "householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerLedgerEntry_organizationId_householdId_idx" ON "PtaVolunteerLedgerEntry"("organizationId", "householdId");

-- CreateIndex
CREATE INDEX "PtaVolunteerLedgerEntry_entryType_idx" ON "PtaVolunteerLedgerEntry"("entryType");

-- CreateIndex
CREATE UNIQUE INDEX "PtaVolunteerLedgerEntry_organizationId_sourceType_sourceId__key" ON "PtaVolunteerLedgerEntry"("organizationId", "sourceType", "sourceId", "entryType");

-- AddForeignKey
ALTER TABLE "PtaVolunteerLedgerEntry" ADD CONSTRAINT "PtaVolunteerLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerLedgerEntry" ADD CONSTRAINT "PtaVolunteerLedgerEntry_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerLedgerEntry" ADD CONSTRAINT "PtaVolunteerLedgerEntry_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerLedgerEntry" ADD CONSTRAINT "PtaVolunteerLedgerEntry_householdAdultId_fkey" FOREIGN KEY ("householdAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerLedgerEntry" ADD CONSTRAINT "PtaVolunteerLedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PtaVolunteerLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
