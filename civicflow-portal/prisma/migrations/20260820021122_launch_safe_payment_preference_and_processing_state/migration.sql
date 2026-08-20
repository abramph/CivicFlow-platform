-- CreateEnum
CREATE TYPE "FixedObligationPaymentPreference" AS ENUM ('CARD_AND_ABSORB', 'PREFER_ACH', 'REQUIRE_ACH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PendingPaymentStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "PendingPaymentStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "fixedObligationPaymentPreference" "FixedObligationPaymentPreference" NOT NULL DEFAULT 'CARD_AND_ABSORB';
