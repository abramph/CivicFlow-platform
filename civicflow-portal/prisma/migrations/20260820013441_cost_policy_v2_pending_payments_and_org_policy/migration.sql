-- CreateEnum
CREATE TYPE "FixedObligationCoveragePolicy" AS ENUM ('REQUIRED_WHERE_PERMITTED', 'ORGANIZATION_ABSORBS');

-- CreateEnum
CREATE TYPE "VoluntaryCoveragePolicy" AS ENUM ('OPTIONAL', 'ORGANIZATION_ABSORBS');

-- CreateEnum
CREATE TYPE "IneligibleMethodFallback" AS ENUM ('ORGANIZATION_ABSORBS', 'REQUIRE_ACH', 'OFFER_ALTERNATIVES');

-- CreateEnum
CREATE TYPE "PaymentNature" AS ENUM ('FIXED_OBLIGATION', 'VOLUNTARY', 'OFFLINE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "PendingPaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'ABANDONED', 'MISMATCHED');

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "netDepositedCents" INTEGER,
ADD COLUMN     "pendingPaymentId" TEXT,
ADD COLUMN     "processorFeeActualCents" INTEGER;

-- AlterTable
ALTER TABLE "DuesPayment" ADD COLUMN     "netDepositedCents" INTEGER,
ADD COLUMN     "pendingPaymentId" TEXT,
ADD COLUMN     "processorFeeActualCents" INTEGER;

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "achEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fixedObligationCoveragePolicy" "FixedObligationCoveragePolicy" NOT NULL DEFAULT 'ORGANIZATION_ABSORBS',
ADD COLUMN     "ineligiblePaymentMethodFallback" "IneligibleMethodFallback" NOT NULL DEFAULT 'ORGANIZATION_ABSORBS',
ADD COLUMN     "policyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "policyAcceptedByUserId" TEXT,
ADD COLUMN     "policyVersion" TEXT,
ADD COLUMN     "voluntaryCoveragePolicy" "VoluntaryCoveragePolicy" NOT NULL DEFAULT 'OPTIONAL';

-- CreateTable
CREATE TABLE "PendingPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT,
    "contributorUserId" TEXT,
    "paymentPurpose" TEXT NOT NULL,
    "paymentNature" "PaymentNature" NOT NULL,
    "duesChargeId" TEXT,
    "paymentLinkId" TEXT,
    "fundId" TEXT,
    "contributionProgramId" TEXT,
    "obligationCents" INTEGER NOT NULL,
    "processingCostCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "coverageMode" TEXT NOT NULL,
    "coverageRequired" BOOLEAN NOT NULL DEFAULT false,
    "coveragePolicyVersion" TEXT,
    "allocationVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyReference" TEXT NOT NULL,
    "stripeConnectedAccountId" TEXT NOT NULL,
    "stripeSessionId" TEXT,
    "status" "PendingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "mismatchReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingPayment_idempotencyReference_key" ON "PendingPayment"("idempotencyReference");

-- CreateIndex
CREATE UNIQUE INDEX "PendingPayment_stripeSessionId_key" ON "PendingPayment"("stripeSessionId");

-- CreateIndex
CREATE INDEX "PendingPayment_organizationId_status_idx" ON "PendingPayment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PendingPayment_organizationId_createdAt_idx" ON "PendingPayment"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "PendingPayment" ADD CONSTRAINT "PendingPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
