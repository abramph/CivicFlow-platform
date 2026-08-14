-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "RecurringScheduleStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'PAUSED', 'PAYMENT_ACTION_REQUIRED', 'PAYMENT_FAILED', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "givingStripeProductId" TEXT;

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "recurringScheduleId" TEXT;

-- CreateTable
CREATE TABLE "GivingCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GivingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringContributionSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT,
    "contributorUserId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "contributionProgramId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "frequency" "RecurringFrequency" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextContributionDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "RecurringScheduleStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "providerPaymentMethodId" TEXT,
    "paymentMethodDescriptor" TEXT,
    "lastSuccessfulContributionAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "pausedAt" TIMESTAMP(3),
    "resumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringContributionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GivingCustomer_stripeCustomerId_key" ON "GivingCustomer"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "GivingCustomer_organizationId_idx" ON "GivingCustomer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GivingCustomer_organizationId_userId_key" ON "GivingCustomer"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringContributionSchedule_providerSubscriptionId_key" ON "RecurringContributionSchedule"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "RecurringContributionSchedule_organizationId_idx" ON "RecurringContributionSchedule"("organizationId");

-- CreateIndex
CREATE INDEX "RecurringContributionSchedule_organizationId_status_idx" ON "RecurringContributionSchedule"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RecurringContributionSchedule_contributorUserId_idx" ON "RecurringContributionSchedule"("contributorUserId");

-- CreateIndex
CREATE INDEX "RecurringContributionSchedule_fundId_idx" ON "RecurringContributionSchedule"("fundId");

-- CreateIndex
CREATE INDEX "Contribution_recurringScheduleId_idx" ON "Contribution"("recurringScheduleId");

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_recurringScheduleId_fkey" FOREIGN KEY ("recurringScheduleId") REFERENCES "RecurringContributionSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GivingCustomer" ADD CONSTRAINT "GivingCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GivingCustomer" ADD CONSTRAINT "GivingCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringContributionSchedule" ADD CONSTRAINT "RecurringContributionSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringContributionSchedule" ADD CONSTRAINT "RecurringContributionSchedule_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringContributionSchedule" ADD CONSTRAINT "RecurringContributionSchedule_contributorUserId_fkey" FOREIGN KEY ("contributorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringContributionSchedule" ADD CONSTRAINT "RecurringContributionSchedule_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringContributionSchedule" ADD CONSTRAINT "RecurringContributionSchedule_contributionProgramId_fkey" FOREIGN KEY ("contributionProgramId") REFERENCES "ContributionProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

