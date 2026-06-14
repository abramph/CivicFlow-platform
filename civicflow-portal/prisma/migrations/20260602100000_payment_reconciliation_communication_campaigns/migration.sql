CREATE TYPE "PaymentImportSourceType" AS ENUM ('ZELLE', 'CASH_APP', 'VENMO', 'PAYPAL', 'STRIPE', 'BANK', 'MANUAL_CSV', 'OTHER');
CREATE TYPE "PaymentImportBatchStatus" AS ENUM ('UPLOADED', 'PARSED', 'REVIEWED', 'POSTED', 'FAILED');
CREATE TYPE "PaymentImportVerificationStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'POSTED');
CREATE TYPE "PaymentImportPostedAs" AS ENUM ('DUES_PAYMENT', 'CONTRIBUTION', 'OTHER');
CREATE TYPE "CommunicationCampaignType" AS ENUM ('ANNOUNCEMENT', 'MEETING_MINUTES', 'DUES_REMINDER', 'EVENT_NOTICE', 'CAMPAIGN_UPDATE', 'GENERAL', 'OTHER');
CREATE TYPE "CommunicationCampaignChannel" AS ENUM ('EMAIL', 'SMS', 'EMAIL_AND_SMS', 'INTERNAL_LOG_ONLY');
CREATE TYPE "CommunicationCampaignStatus" AS ENUM ('DRAFT', 'READY', 'SENDING', 'SENT', 'FAILED', 'CANCELED');
CREATE TYPE "CommunicationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "PaymentMethodConfig"
  ADD COLUMN "accountIdentifier" TEXT,
  ADD COLUMN "notes" TEXT;

CREATE TABLE "PaymentImportBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sourceType" "PaymentImportSourceType" NOT NULL,
  "fileName" TEXT,
  "status" "PaymentImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
  "uploadedByUserId" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentImportItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceType" "PaymentImportSourceType" NOT NULL,
  "externalTransactionId" TEXT,
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "payerName" TEXT,
  "payerEmail" TEXT,
  "payerPhone" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "memo" TEXT,
  "rawData" JSONB,
  "matchedMemberId" TEXT,
  "matchedDuesChargeId" TEXT,
  "matchedCampaignId" TEXT,
  "matchedEventId" TEXT,
  "matchConfidence" INTEGER,
  "verificationStatus" "PaymentImportVerificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "postedAs" "PaymentImportPostedAs",
  "postedDuesPaymentId" TEXT,
  "postedContributionId" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentImportItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunicationCampaign" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "communicationType" "CommunicationCampaignType" NOT NULL,
  "channel" "CommunicationCampaignChannel" NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "CommunicationCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "recipientFilter" JSONB,
  "attachmentKeys" JSONB,
  "meetingId" TEXT,
  "createdByUserId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunicationCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunicationRecipient" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "memberId" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "deliveryStatus" "CommunicationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunicationRecipient_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentImportBatch" ADD CONSTRAINT "PaymentImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_matchedMemberId_fkey" FOREIGN KEY ("matchedMemberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_matchedDuesChargeId_fkey" FOREIGN KEY ("matchedDuesChargeId") REFERENCES "DuesCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_matchedCampaignId_fkey" FOREIGN KEY ("matchedCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_matchedEventId_fkey" FOREIGN KEY ("matchedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_postedDuesPaymentId_fkey" FOREIGN KEY ("postedDuesPaymentId") REFERENCES "DuesPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentImportItem" ADD CONSTRAINT "PaymentImportItem_postedContributionId_fkey" FOREIGN KEY ("postedContributionId") REFERENCES "Contribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommunicationCampaign" ADD CONSTRAINT "CommunicationCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationCampaign" ADD CONSTRAINT "CommunicationCampaign_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationCampaign" ADD CONSTRAINT "CommunicationCampaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CommunicationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PaymentImportItem_organizationId_sourceType_externalTransactionId_key" ON "PaymentImportItem"("organizationId", "sourceType", "externalTransactionId");
CREATE INDEX "PaymentImportBatch_organizationId_idx" ON "PaymentImportBatch"("organizationId");
CREATE INDEX "PaymentImportBatch_sourceType_idx" ON "PaymentImportBatch"("sourceType");
CREATE INDEX "PaymentImportBatch_status_idx" ON "PaymentImportBatch"("status");
CREATE INDEX "PaymentImportBatch_uploadedAt_idx" ON "PaymentImportBatch"("uploadedAt");
CREATE INDEX "PaymentImportItem_organizationId_idx" ON "PaymentImportItem"("organizationId");
CREATE INDEX "PaymentImportItem_batchId_idx" ON "PaymentImportItem"("batchId");
CREATE INDEX "PaymentImportItem_sourceType_idx" ON "PaymentImportItem"("sourceType");
CREATE INDEX "PaymentImportItem_matchedMemberId_idx" ON "PaymentImportItem"("matchedMemberId");
CREATE INDEX "PaymentImportItem_matchedDuesChargeId_idx" ON "PaymentImportItem"("matchedDuesChargeId");
CREATE INDEX "PaymentImportItem_verificationStatus_idx" ON "PaymentImportItem"("verificationStatus");
CREATE INDEX "PaymentImportItem_postedAs_idx" ON "PaymentImportItem"("postedAs");
CREATE INDEX "PaymentImportItem_transactionDate_idx" ON "PaymentImportItem"("transactionDate");
CREATE INDEX "CommunicationCampaign_organizationId_idx" ON "CommunicationCampaign"("organizationId");
CREATE INDEX "CommunicationCampaign_communicationType_idx" ON "CommunicationCampaign"("communicationType");
CREATE INDEX "CommunicationCampaign_channel_idx" ON "CommunicationCampaign"("channel");
CREATE INDEX "CommunicationCampaign_status_idx" ON "CommunicationCampaign"("status");
CREATE INDEX "CommunicationCampaign_sentAt_idx" ON "CommunicationCampaign"("sentAt");
CREATE INDEX "CommunicationCampaign_createdAt_idx" ON "CommunicationCampaign"("createdAt");
CREATE INDEX "CommunicationRecipient_organizationId_idx" ON "CommunicationRecipient"("organizationId");
CREATE INDEX "CommunicationRecipient_campaignId_idx" ON "CommunicationRecipient"("campaignId");
CREATE INDEX "CommunicationRecipient_memberId_idx" ON "CommunicationRecipient"("memberId");
CREATE INDEX "CommunicationRecipient_deliveryStatus_idx" ON "CommunicationRecipient"("deliveryStatus");
CREATE INDEX "CommunicationRecipient_sentAt_idx" ON "CommunicationRecipient"("sentAt");
