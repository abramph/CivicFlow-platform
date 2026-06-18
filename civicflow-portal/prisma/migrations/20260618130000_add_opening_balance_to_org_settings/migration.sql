-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN "openingBalanceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgSettings" ADD COLUMN "openingBalanceDate" TIMESTAMP(3);
