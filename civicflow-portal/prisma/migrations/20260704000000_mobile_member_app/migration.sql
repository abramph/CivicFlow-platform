-- CreateEnum
CREATE TYPE "MobileDevicePlatform" AS ENUM ('ios', 'android', 'web');

-- CreateEnum
CREATE TYPE "PaymentReportStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
ALTER TYPE "OrgRole" ADD VALUE 'MEMBER';

-- AlterEnum
ALTER TYPE "CommunicationType" ADD VALUE 'PUSH';

-- AlterEnum
ALTER TYPE "AttachmentEntityType" ADD VALUE 'PAYMENT_REPORT';

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN     "commsEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "commsPushEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "commsSmsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiredNoticesOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "CommunicationCampaign" ADD COLUMN     "deepLink" TEXT,
ADD COLUMN     "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CommunicationRecipient" ADD COLUMN     "pushDeliveryStatus" "CommunicationDeliveryStatus",
ADD COLUMN     "pushError" TEXT,
ADD COLUMN     "pushSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MemberInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileDeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "platform" "MobileDevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "deviceName" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileDeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "DuesPaymentMethod" NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "referenceNumber" TEXT,
    "note" TEXT,
    "receiptAttachmentId" TEXT,
    "status" "PaymentReportStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberInvite_tokenHash_key" ON "MemberInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberInvite_organizationId_idx" ON "MemberInvite"("organizationId");

-- CreateIndex
CREATE INDEX "MemberInvite_memberId_idx" ON "MemberInvite"("memberId");

-- CreateIndex
CREATE INDEX "MemberInvite_expiresAt_idx" ON "MemberInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "MobileDeviceToken_userId_idx" ON "MobileDeviceToken"("userId");

-- CreateIndex
CREATE INDEX "MobileDeviceToken_organizationId_idx" ON "MobileDeviceToken"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MobileDeviceToken_userId_token_key" ON "MobileDeviceToken"("userId", "token");

-- CreateIndex
CREATE INDEX "PaymentReport_organizationId_idx" ON "PaymentReport"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentReport_organizationId_status_idx" ON "PaymentReport"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PaymentReport_memberId_idx" ON "PaymentReport"("memberId");

-- CreateIndex
CREATE INDEX "PaymentReport_createdAt_idx" ON "PaymentReport"("createdAt");

-- CreateIndex
CREATE INDEX "OrgMember_userId_idx" ON "OrgMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMember_organizationId_userId_key" ON "OrgMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "CommunicationCampaign_scheduledFor_idx" ON "CommunicationCampaign"("scheduledFor");

-- AddForeignKey
ALTER TABLE "OrgMember" ADD CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeviceToken" ADD CONSTRAINT "MobileDeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileDeviceToken" ADD CONSTRAINT "MobileDeviceToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrgMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_receiptAttachmentId_fkey" FOREIGN KEY ("receiptAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

