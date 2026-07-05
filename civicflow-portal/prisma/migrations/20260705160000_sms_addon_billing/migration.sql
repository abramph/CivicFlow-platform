-- CreateEnum
CREATE TYPE "SmsMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN     "smsOptedOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrganizationSmsSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "smsAddOnActive" BOOLEAN NOT NULL DEFAULT false,
    "smsMonthlyLimit" INTEGER NOT NULL DEFAULT 0,
    "smsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "smsOverageRateCents" INTEGER NOT NULL DEFAULT 2,
    "smsBillingPeriodStart" TIMESTAMP(3),
    "smsBillingPeriodEnd" TIMESTAMP(3),
    "stripeSmsSubscriptionItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSmsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SmsMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "providerMessageId" TEXT,
    "costEstimateCents" INTEGER,
    "campaignId" TEXT,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSmsSettings_organizationId_key" ON "OrganizationSmsSettings"("organizationId");

-- CreateIndex
CREATE INDEX "SmsMessage_organizationId_idx" ON "SmsMessage"("organizationId");

-- CreateIndex
CREATE INDEX "SmsMessage_campaignId_idx" ON "SmsMessage"("campaignId");

-- CreateIndex
CREATE INDEX "SmsMessage_status_idx" ON "SmsMessage"("status");

-- CreateIndex
CREATE INDEX "SmsMessage_createdAt_idx" ON "SmsMessage"("createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_memberId_idx" ON "SmsMessage"("memberId");

-- AddForeignKey
ALTER TABLE "OrganizationSmsSettings" ADD CONSTRAINT "OrganizationSmsSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CommunicationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

