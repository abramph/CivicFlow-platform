-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "lastInboundAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");
