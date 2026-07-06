-- CreateEnum
CREATE TYPE "PaymentReportCategory" AS ENUM ('MEMBERSHIP_DUES', 'EVENT_REGISTRATION', 'DONATION', 'FUNDRAISER', 'MERCHANDISE', 'SPONSORSHIP', 'ASSESSMENT', 'OTHER');

-- AlterTable
ALTER TABLE "PaymentReport" ADD COLUMN     "category" "PaymentReportCategory" NOT NULL DEFAULT 'MEMBERSHIP_DUES',
ADD COLUMN     "duesChargeId" TEXT;

-- CreateIndex
CREATE INDEX "PaymentReport_category_idx" ON "PaymentReport"("category");

-- AddForeignKey
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_duesChargeId_fkey" FOREIGN KEY ("duesChargeId") REFERENCES "DuesCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
