-- CreateEnum
CREATE TYPE "WhatsAppOptInSource" AS ENUM ('SELF_SERVICE', 'ADMIN_ASSISTED', 'WHATSAPP_REPLY', 'INVITE_ONBOARDING');

-- CreateEnum
CREATE TYPE "WhatsAppOptInStatus" AS ENUM ('NOT_STARTED', 'OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNDELIVERED');

-- CreateEnum
CREATE TYPE "WhatsAppTemplateCategory" AS ENUM ('UTILITY', 'AUTHENTICATION', 'MARKETING');

-- CreateEnum
CREATE TYPE "WhatsAppTemplateApprovalStatus" AS ENUM ('DRAFT', 'PENDING_SUBMISSION', 'SUBMITTED', 'APPROVED', 'REJECTED', 'DISABLED');

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN     "whatsappConsentTextVersion" TEXT,
ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappLastConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "whatsappOptInIP" TEXT,
ADD COLUMN     "whatsappOptInSource" "WhatsAppOptInSource",
ADD COLUMN     "whatsappOptInStatus" "WhatsAppOptInStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "whatsappOptedInAt" TIMESTAMP(3),
ADD COLUMN     "whatsappOptedOutAt" TIMESTAMP(3),
ADD COLUMN     "whatsappPhoneNumber" TEXT;

-- CreateTable
CREATE TABLE "PlatformWhatsAppSettings" (
    "id" TEXT NOT NULL,
    "platformEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sandboxMode" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "outboundPaused" BOOLEAN NOT NULL DEFAULT false,
    "orgMessagingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fromNumberEncrypted" TEXT,
    "messagingServiceSidEncrypted" TEXT,
    "testPhoneNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformWhatsAppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationWhatsAppSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "whatsappAddOnActive" BOOLEAN NOT NULL DEFAULT false,
    "whatsappMonthlyLimit" INTEGER NOT NULL DEFAULT 0,
    "whatsappUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "whatsappOverageRateCents" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "whatsappBillingPeriodStart" TIMESTAMP(3),
    "whatsappBillingPeriodEnd" TIMESTAMP(3),
    "stripeWhatsAppSubscriptionItemId" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "lastUsageThresholdNotified" INTEGER NOT NULL DEFAULT 0,
    "quietHoursStartHour" INTEGER NOT NULL DEFAULT 21,
    "quietHoursEndHour" INTEGER NOT NULL DEFAULT 8,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pilotMode" BOOLEAN NOT NULL DEFAULT true,
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationWhatsAppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "twilioContentSid" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "category" "WhatsAppTemplateCategory" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvalStatus" "WhatsAppTemplateApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "variablesSchema" JSONB NOT NULL,
    "permittedWorkflows" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT,
    "phone" TEXT NOT NULL,
    "templateKey" TEXT,
    "category" "WhatsAppTemplateCategory",
    "body" TEXT,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "providerMessageId" TEXT,
    "costEstimateCents" INTEGER,
    "actualCostCents" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "campaignId" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationWhatsAppSettings_organizationId_key" ON "OrganizationWhatsAppSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_key_key" ON "WhatsAppTemplate"("key");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_organizationId_idx" ON "WhatsAppMessage"("organizationId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_campaignId_idx" ON "WhatsAppMessage"("campaignId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_idx" ON "WhatsAppMessage"("status");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_createdAt_idx" ON "WhatsAppMessage"("createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_memberId_idx" ON "WhatsAppMessage"("memberId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_providerMessageId_idx" ON "WhatsAppMessage"("providerMessageId");

-- AddForeignKey
ALTER TABLE "OrganizationWhatsAppSettings" ADD CONSTRAINT "OrganizationWhatsAppSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CommunicationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
