-- CreateEnum
CREATE TYPE "PaymentLinkType" AS ENUM ('GENERAL', 'CAMPAIGN', 'EVENT', 'DUES');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "linkType" "PaymentLinkType" NOT NULL DEFAULT 'GENERAL',
    "amount" DECIMAL(12,2),
    "minAmount" DECIMAL(12,2),
    "campaignId" TEXT,
    "eventId" TEXT,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLink_slug_key" ON "PaymentLink"("slug");

-- CreateIndex
CREATE INDEX "PaymentLink_organizationId_idx" ON "PaymentLink"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentLink_slug_idx" ON "PaymentLink"("slug");

-- CreateIndex
CREATE INDEX "PaymentLink_organizationId_status_idx" ON "PaymentLink"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PaymentLink_campaignId_idx" ON "PaymentLink"("campaignId");

-- CreateIndex
CREATE INDEX "PaymentLink_eventId_idx" ON "PaymentLink"("eventId");

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
