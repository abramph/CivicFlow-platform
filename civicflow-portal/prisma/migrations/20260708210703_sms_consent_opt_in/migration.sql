-- CreateEnum
CREATE TYPE "SmsOptInMethod" AS ENUM ('WEBSITE_REGISTRATION', 'PROFILE_SETTINGS', 'QR_CODE');

-- AlterTable
ALTER TABLE "OrgMember" ADD COLUMN     "smsConsentVersion" TEXT,
ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsOptInDate" TIMESTAMP(3),
ADD COLUMN     "smsOptInIP" TEXT,
ADD COLUMN     "smsOptInMethod" "SmsOptInMethod",
ADD COLUMN     "smsOptOutDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "mfaBackupCodes" DROP DEFAULT;
