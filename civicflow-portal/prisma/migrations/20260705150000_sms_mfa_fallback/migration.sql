-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MfaChallengeToken" ADD COLUMN     "codeHash" TEXT,
ADD COLUMN     "phone" TEXT;
