-- AlterTable
ALTER TABLE "PtaCommittee" ADD COLUMN     "coChairAdultId" TEXT;

-- AddForeignKey
ALTER TABLE "PtaCommittee" ADD CONSTRAINT "PtaCommittee_coChairAdultId_fkey" FOREIGN KEY ("coChairAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

