-- CreateEnum
CREATE TYPE "TollFreeVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SmsMessageStatus" ADD VALUE 'SENDING';
ALTER TYPE "SmsMessageStatus" ADD VALUE 'RETRYING';

-- AlterTable
ALTER TABLE "OrganizationSmsSettings" ADD COLUMN     "lastUsageThresholdNotified" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'STARTER',
ADD COLUMN     "planPriceCents" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "actualCostCents" INTEGER,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlatformSmsSettings" (
    "id" TEXT NOT NULL,
    "platformEnabled" BOOLEAN NOT NULL DEFAULT false,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "outboundPaused" BOOLEAN NOT NULL DEFAULT false,
    "mfaSmsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "orgMessagingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "accountSidEncrypted" TEXT,
    "authTokenEncrypted" TEXT,
    "apiKeyEncrypted" TEXT,
    "apiSecretEncrypted" TEXT,
    "messagingServiceSidEncrypted" TEXT,
    "tollFreeNumberEncrypted" TEXT,
    "verifyServiceSidEncrypted" TEXT,
    "tollFreeVerificationSid" TEXT,
    "tollFreeVerificationStatus" "TollFreeVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "tollFreeVerificationSubmittedAt" TIMESTAMP(3),
    "tollFreeVerificationApprovedAt" TIMESTAMP(3),
    "tollFreeVerificationLastCheckedAt" TIMESTAMP(3),
    "testPhoneNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "carrierFeePercent" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSmsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMessage_providerMessageId_idx" ON "SmsMessage"("providerMessageId");
