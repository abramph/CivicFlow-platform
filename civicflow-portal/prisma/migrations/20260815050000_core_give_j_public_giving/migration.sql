-- CreateEnum
CREATE TYPE "GuestMatchStatus" AS ENUM ('UNLINKED', 'MATCH_SUGGESTED', 'LINKED');

-- AlterEnum
ALTER TYPE "ContributionSource" ADD VALUE 'PUBLIC_PAGE';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "showPublicProgress" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "publicGivingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicGivingMessage" TEXT;

-- AlterTable
ALTER TABLE "Contribution" ADD COLUMN     "guestEmail" TEXT,
ADD COLUMN     "guestMatchStatus" "GuestMatchStatus";

