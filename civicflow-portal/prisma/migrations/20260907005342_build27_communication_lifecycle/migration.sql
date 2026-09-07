-- AlterTable
ALTER TABLE "CommunicationCampaign" ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnByUserId" TEXT;

-- AlterTable
ALTER TABLE "CommunicationRecipient" ADD COLUMN     "archivedAt" TIMESTAMP(3);
