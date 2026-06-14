ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'inactive';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'deactivated';
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'pending';

ALTER TYPE "MemberTimelineEventType" ADD VALUE IF NOT EXISTS 'DEACTIVATED';
ALTER TYPE "MemberTimelineEventType" ADD VALUE IF NOT EXISTS 'TERMINATED';
ALTER TYPE "MemberTimelineEventType" ADD VALUE IF NOT EXISTS 'REACTIVATED';
ALTER TYPE "MemberTimelineEventType" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "MemberTimelineEventType" ADD VALUE IF NOT EXISTS 'RETIRED';

CREATE TYPE "DuesStartRule" AS ENUM ('JOIN_DATE', 'FIRST_OF_NEXT_MONTH', 'MANUAL');
CREATE TYPE "DuesAdjustmentType" AS ENUM ('WAIVER', 'DISCOUNT', 'CREDIT', 'WRITE_OFF', 'MANUAL_ADJUSTMENT');

ALTER TABLE "OrgSettings"
  ADD COLUMN "financialEditWindowHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "requireReasonForFinancialEdits" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowFinanceCorrections" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lockReceiptsAfterIssue" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "duesStartRule" "DuesStartRule" NOT NULL DEFAULT 'JOIN_DATE',
  ADD COLUMN "delinquentAfterMonths" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "delinquentAfterDays" INTEGER,
  ADD COLUMN "autoMarkDelinquent" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autoSuspendAfterMonths" INTEGER,
  ADD COLUMN "autoDeactivateAfterMonths" INTEGER,
  ADD COLUMN "reminderFrequencyDays" INTEGER;

ALTER TABLE "OrgMember"
  ADD COLUMN "statusChangedAt" TIMESTAMP(3),
  ADD COLUMN "statusChangedByUserId" TEXT,
  ADD COLUMN "statusChangeReason" TEXT,
  ADD COLUMN "isDelinquent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "delinquentSince" TIMESTAMP(3),
  ADD COLUMN "lastDuesEvaluationAt" TIMESTAMP(3);

CREATE INDEX "OrgMember_organizationId_isDelinquent_idx" ON "OrgMember"("organizationId", "isDelinquent");

ALTER TABLE "DuesCharge"
  ADD COLUMN "periodStart" TIMESTAMP(3),
  ADD COLUMN "periodEnd" TIMESTAMP(3),
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" TEXT,
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "correctionOfId" TEXT,
  ADD COLUMN "correctedById" TEXT,
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editReason" TEXT;

CREATE INDEX "DuesCharge_periodStart_idx" ON "DuesCharge"("periodStart");
CREATE INDEX "DuesCharge_periodEnd_idx" ON "DuesCharge"("periodEnd");
CREATE UNIQUE INDEX "DuesCharge_organizationId_memberId_duesAccountId_periodStart_periodEnd_key"
  ON "DuesCharge"("organizationId", "memberId", "duesAccountId", "periodStart", "periodEnd");

ALTER TABLE "DuesPayment"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" TEXT,
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "correctionOfId" TEXT,
  ADD COLUMN "correctedById" TEXT,
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editReason" TEXT;

CREATE TABLE "DuesAdjustment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "duesChargeId" TEXT,
  "adjustmentType" "DuesAdjustmentType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DuesAdjustment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DuesAdjustment" ADD CONSTRAINT "DuesAdjustment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuesAdjustment" ADD CONSTRAINT "DuesAdjustment_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuesAdjustment" ADD CONSTRAINT "DuesAdjustment_duesChargeId_fkey"
  FOREIGN KEY ("duesChargeId") REFERENCES "DuesCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DuesAdjustment_organizationId_idx" ON "DuesAdjustment"("organizationId");
CREATE INDEX "DuesAdjustment_memberId_idx" ON "DuesAdjustment"("memberId");
CREATE INDEX "DuesAdjustment_duesChargeId_idx" ON "DuesAdjustment"("duesChargeId");
CREATE INDEX "DuesAdjustment_adjustmentType_idx" ON "DuesAdjustment"("adjustmentType");
CREATE INDEX "DuesAdjustment_createdAt_idx" ON "DuesAdjustment"("createdAt");

ALTER TABLE "Contribution"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" TEXT,
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "correctionOfId" TEXT,
  ADD COLUMN "correctedById" TEXT,
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editReason" TEXT;

ALTER TABLE "ContributionReceipt"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" TEXT,
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "correctionOfId" TEXT,
  ADD COLUMN "correctedById" TEXT,
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editReason" TEXT;

ALTER TABLE "Expenditure"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByUserId" TEXT,
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "correctionOfId" TEXT,
  ADD COLUMN "correctedById" TEXT,
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "editReason" TEXT;
