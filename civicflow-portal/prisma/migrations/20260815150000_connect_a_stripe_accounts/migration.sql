-- CreateEnum
CREATE TYPE "ProviderAccountContext" AS ENUM ('LEGACY_PLATFORM_PAYMENT', 'CONNECTED_ACCOUNT_PAYMENT');

-- CreateEnum
CREATE TYPE "StripeAccountStatus" AS ENUM ('ONBOARDING_STARTED', 'ACTION_REQUIRED', 'CONNECTED', 'PAYMENTS_ENABLED', 'RESTRICTED', 'DISABLED');

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "providerAccountContext" "ProviderAccountContext",
ADD COLUMN     "stripeConnectedAccountId" TEXT;

-- AlterTable
ALTER TABLE "RecurringContributionSchedule" ADD COLUMN     "providerAccountContext" "ProviderAccountContext",
ADD COLUMN     "stripeConnectedAccountId" TEXT;

-- CreateTable
CREATE TABLE "OrganizationStripeAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "accountMode" TEXT NOT NULL DEFAULT 'live',
    "onboardingStatus" "StripeAccountStatus" NOT NULL DEFAULT 'ONBOARDING_STARTED',
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "requirementsCurrentlyDueCount" INTEGER NOT NULL DEFAULT 0,
    "requirementsEventuallyDueCount" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT,
    "defaultCurrency" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationStripeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMemberStripeCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT,
    "stripeConnectedAccountId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMemberStripeCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationStripeAccount_organizationId_key" ON "OrganizationStripeAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationStripeAccount_stripeAccountId_key" ON "OrganizationStripeAccount"("stripeAccountId");

-- CreateIndex
CREATE INDEX "OrganizationStripeAccount_onboardingStatus_idx" ON "OrganizationStripeAccount"("onboardingStatus");

-- CreateIndex
CREATE INDEX "OrganizationMemberStripeCustomer_organizationId_idx" ON "OrganizationMemberStripeCustomer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMemberStripeCustomer_organizationId_userId_stri_key" ON "OrganizationMemberStripeCustomer"("organizationId", "userId", "stripeConnectedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMemberStripeCustomer_stripeConnectedAccountId_s_key" ON "OrganizationMemberStripeCustomer"("stripeConnectedAccountId", "stripeCustomerId");

-- AddForeignKey
ALTER TABLE "OrganizationStripeAccount" ADD CONSTRAINT "OrganizationStripeAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMemberStripeCustomer" ADD CONSTRAINT "OrganizationMemberStripeCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMemberStripeCustomer" ADD CONSTRAINT "OrganizationMemberStripeCustomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

